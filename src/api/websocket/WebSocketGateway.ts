import type { WebSocket } from 'ws';
import type { WebSocketEventType, WebSocketMessage } from './types.js';
import { logger } from '../../telemetry/logger.js';

export interface WebSocketGatewayOptions {
  /** Hard cap on concurrent connections. Default 500. */
  maxConnections?: number;
  /** How often to ping clients and reap ones that didn't pong since the last ping. Default 30s. */
  heartbeatIntervalMs?: number;
  /** Max new connections accepted within `connectionWindowMs`, to blunt connection-storm DoS. Default 30. */
  maxNewConnectionsPerWindow?: number;
  connectionWindowMs?: number;
}

export class WebSocketGateway {
  private clients = new Set<WebSocket>();
  // H-05: tracks whether each client answered the last ping. A dead TCP
  // connection (network drop without a clean close) never fires 'close' or
  // 'error' — without this heartbeat, such clients lingered in `clients`
  // indefinitely, wasting broadcast cycles on sockets nothing is reading.
  private alive = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private readonly maxConnections: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxNewConnectionsPerWindow: number;
  private readonly connectionWindowMs: number;
  private recentConnectionTimestamps: number[] = [];

  constructor(options: WebSocketGatewayOptions = {}) {
    this.maxConnections = options.maxConnections ?? 500;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.maxNewConnectionsPerWindow = options.maxNewConnectionsPerWindow ?? 30;
    this.connectionWindowMs = options.connectionWindowMs ?? 10_000;
    this.startHeartbeat();
  }

  /**
   * Registers a client. Returns false (and closes the socket) if it was
   * rejected by the connection cap (H-06) or the connection-rate limit
   * (H-06) — callers don't need to check the return value themselves since
   * rejection is already handled here, but tests can assert on it.
   */
  public addClient(ws: WebSocket): boolean {
    if (this.clients.size >= this.maxConnections) {
      logger.warn({ maxConnections: this.maxConnections }, '[WebSocketGateway] rejecting connection: max connections reached');
      this.safeClose(ws, 1013, 'Max connections reached');
      return false;
    }

    const now = Date.now();
    this.recentConnectionTimestamps = this.recentConnectionTimestamps.filter(
      (t) => now - t < this.connectionWindowMs
    );
    if (this.recentConnectionTimestamps.length >= this.maxNewConnectionsPerWindow) {
      logger.warn(
        { maxNewConnectionsPerWindow: this.maxNewConnectionsPerWindow, connectionWindowMs: this.connectionWindowMs },
        '[WebSocketGateway] rejecting connection: connection rate limit exceeded'
      );
      this.safeClose(ws, 1013, 'Connection rate limit exceeded');
      return false;
    }
    this.recentConnectionTimestamps.push(now);

    this.clients.add(ws);
    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('close', () => this.removeClient(ws));
    ws.on('error', () => this.removeClient(ws));
    return true;
  }

  public removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public broadcast<T>(type: WebSocketEventType, payload: T): void {
    const msg: WebSocketMessage<T> = {
      type,
      payload,
      timestampUtc: new Date().toISOString(),
    };
    const serialized = JSON.stringify(msg);

    for (const client of this.clients) {
      if (client.readyState === 1) { // 1 = OPEN
        try {
          client.send(serialized);
        } catch {
          this.removeClient(client);
        }
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (this.alive.get(client) === false) {
          try {
            client.terminate();
          } catch {
            // already gone
          }
          this.removeClient(client);
          continue;
        }
        this.alive.set(client, false);
        try {
          client.ping();
        } catch {
          this.removeClient(client);
        }
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // ignore — socket may already be closing
    }
  }

  public closeAll(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // ignore on shutdown
      }
    }
    this.clients.clear();
  }
}
