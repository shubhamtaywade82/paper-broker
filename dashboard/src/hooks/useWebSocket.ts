import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useStore, type ClosedCandle } from '../store/useStore';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const {
    setWsConnected,
    addLiveEvent,
    setAccount,
    setLivePrice,
    setClosedCandle,
    setOperatingMode,
    setAggressiveMode,
  } = useStore();

  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout;
    let isMounted = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const connect = () => {
      if (!isMounted) return;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isMounted) setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string) as {
              type: string;
              payload: Record<string, unknown>;
              timestampUtc?: string;
            };

            switch (data.type) {
              case 'market.tick':
                if (data.payload.symbol && data.payload.price) {
                  setLivePrice(String(data.payload.symbol), Number(data.payload.price));
                }
                break;
              case 'trade.stream':
                if (data.payload.symbol && data.payload.price) {
                  setLivePrice(String(data.payload.symbol), Number(data.payload.price));
                }
                break;
              case 'book.update':
                if (data.payload.symbol && (data.payload.lastPrice || data.payload.price)) {
                  setLivePrice(String(data.payload.symbol), Number(data.payload.lastPrice || data.payload.price));
                }
                break;
              case 'kline.closed':
                if (data.payload.symbol && data.payload.interval && data.payload.openTime) {
                  setClosedCandle(data.payload as unknown as ClosedCandle);
                }
                break;
              case 'account.updated':
                if (data.payload) setAccount(data.payload as never);
                break;
              case 'order.updated':
              case 'order.filled':
                queryClient.invalidateQueries({ queryKey: ['open-orders'] });
                queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                addLiveEvent({ type: 'order', stream: 'trading', payload: data.payload });
                break;
              case 'position.updated':
                queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                queryClient.invalidateQueries({ queryKey: ['risk-summary'] });
                addLiveEvent({ type: 'position', stream: 'trading', payload: data.payload });
                break;
              case 'agent.cycle':
                addLiveEvent({ type: 'cycle', stream: 'agent', payload: data.payload });
                queryClient.invalidateQueries({ queryKey: ['cycles'] });
                queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                break;
              case 'agent.step':
                addLiveEvent({ type: 'agent_step', stream: 'agent', payload: data.payload });
                break;
              case 'risk.alert':
              case 'incident.reported':
                addLiveEvent({ type: 'risk', stream: 'risk', payload: data.payload });
                queryClient.invalidateQueries({ queryKey: ['risk-summary'] });
                break;
              case 'mode.changed':
                if (data.payload.mode) {
                  setOperatingMode(
                    data.payload.mode as 'paper' | 'shadow' | 'live',
                    Boolean(data.payload.liveArmed)
                  );
                }
                addLiveEvent({ type: 'system', stream: 'system', payload: data.payload });
                break;
              case 'mode.aggressive':
                if (typeof data.payload.aggressive === 'boolean') {
                  setAggressiveMode(data.payload.aggressive);
                }
                queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                addLiveEvent({ type: 'system', stream: 'system', payload: data.payload });
                break;
              case 'kill_switch.activated':
                addLiveEvent({ type: 'system', stream: 'system', payload: data.payload });
                queryClient.invalidateQueries({ queryKey: ['dashboard'] });
                queryClient.invalidateQueries({ queryKey: ['open-orders'] });
                break;
              default:
                addLiveEvent({ type: data.type, stream: 'system', payload: data.payload });
            }
          } catch (err) {
            console.error('[WS] Parse error:', err);
          }
        };

        ws.onclose = () => {
          if (isMounted) {
            setWsConnected(false);
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        };
      } catch {
        if (isMounted) reconnectTimeout = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimeout);
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws.close();
        }
      }
    };
  }, [addLiveEvent, queryClient, setAccount, setLivePrice, setClosedCandle, setOperatingMode, setWsConnected]);
}
