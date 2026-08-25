import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketGateway } from '../../src/api/websocket/WebSocketGateway.js';
import type { WebSocket } from 'ws';

function makeMockSocket(readyState = 1) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
  } as unknown as WebSocket & { emit: (event: string, ...args: unknown[]) => void };
}

describe('WebSocketGateway', () => {
  it('adds and removes clients correctly', () => {
    const gateway = new WebSocketGateway();
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    gateway.addClient(mockWs);
    expect(gateway.getClientCount()).toBe(1);

    gateway.removeClient(mockWs);
    expect(gateway.getClientCount()).toBe(0);
  });

  it('broadcasts typed messages to connected clients', () => {
    const gateway = new WebSocketGateway();
    const mockWs1 = {
      readyState: 1, // OPEN
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    const mockWs2 = {
      readyState: 3, // CLOSED
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    gateway.addClient(mockWs1);
    gateway.addClient(mockWs2);

    gateway.broadcast('market.tick', { symbol: 'SOLUSDT', price: 91.5 });

    expect(mockWs1.send).toHaveBeenCalled();
    const payload = JSON.parse((mockWs1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(payload.type).toBe('market.tick');
    expect(payload.payload.symbol).toBe('SOLUSDT');
    expect(payload.payload.price).toBe(91.5);
    expect(payload.timestampUtc).toBeDefined();

    expect(mockWs2.send).not.toHaveBeenCalled();
  });

  it('handles client send errors gracefully and unregisters them', () => {
    const gateway = new WebSocketGateway();
    const mockWs = {
      readyState: 1,
      send: vi.fn().mockImplementation(() => {
        throw new Error('Socket write error');
      }),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    gateway.addClient(mockWs);
    expect(gateway.getClientCount()).toBe(1);

    gateway.broadcast('signal.created', { signalId: 'sig-1' });
    expect(gateway.getClientCount()).toBe(0);
  });
});

describe('WebSocketGateway heartbeat (H-05)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings clients on the heartbeat interval and terminates ones that never ponged', () => {
    const gateway = new WebSocketGateway({ heartbeatIntervalMs: 1000 });
    const responsive = makeMockSocket();
    const deadConnection = makeMockSocket();
    gateway.addClient(responsive);
    gateway.addClient(deadConnection);

    // First heartbeat tick: both get pinged, neither has answered yet.
    vi.advanceTimersByTime(1000);
    expect(responsive.ping).toHaveBeenCalledTimes(1);
    expect(deadConnection.ping).toHaveBeenCalledTimes(1);
    expect(gateway.getClientCount()).toBe(2);

    // Only the responsive client answers before the next tick.
    (responsive as unknown as { emit: (e: string) => void }).emit('pong');

    // Second tick: the client that never answered the first ping gets reaped;
    // the one that answered gets pinged again and survives.
    vi.advanceTimersByTime(1000);
    expect(deadConnection.terminate).toHaveBeenCalledTimes(1);
    expect(gateway.getClientCount()).toBe(1);
    expect(responsive.ping).toHaveBeenCalledTimes(2);

    gateway.closeAll();
  });
});

describe('WebSocketGateway connection limits (H-06)', () => {
  it('rejects and closes connections once the max connection count is reached', () => {
    const gateway = new WebSocketGateway({ maxConnections: 2, maxNewConnectionsPerWindow: 100 });
    const a = makeMockSocket();
    const b = makeMockSocket();
    const c = makeMockSocket();

    expect(gateway.addClient(a)).toBe(true);
    expect(gateway.addClient(b)).toBe(true);
    expect(gateway.addClient(c)).toBe(false);

    expect(gateway.getClientCount()).toBe(2);
    expect(c.close).toHaveBeenCalledWith(1013, 'Max connections reached');

    gateway.closeAll();
  });

  it('rejects connections once the per-window rate limit is exceeded', () => {
    const gateway = new WebSocketGateway({ maxConnections: 100, maxNewConnectionsPerWindow: 3, connectionWindowMs: 10_000 });

    for (let i = 0; i < 3; i++) {
      expect(gateway.addClient(makeMockSocket())).toBe(true);
    }
    const rejected = makeMockSocket();
    expect(gateway.addClient(rejected)).toBe(false);
    expect(rejected.close).toHaveBeenCalledWith(1013, 'Connection rate limit exceeded');

    gateway.closeAll();
  });
});
