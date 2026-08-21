import { describe, it, expect, vi } from 'vitest';
import { WebSocketGateway } from '../../src/api/websocket/WebSocketGateway.js';
import type { WebSocket } from 'ws';

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
