import type { WebSocket } from 'ws';
import type { WebSocketEventType, WebSocketMessage } from './types.js';

export class WebSocketGateway {
  private clients = new Set<WebSocket>();

  public addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.removeClient(ws));
    ws.on('error', () => this.removeClient(ws));
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

  public closeAll(): void {
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
