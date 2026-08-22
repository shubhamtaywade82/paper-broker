import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useStore } from '../store/useStore';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const {
    setWsConnected,
    addLiveEvent,
    setAccount,
    setLivePrice,
  } = useStore();

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string;
            payload: Record<string, unknown>;
          };

          switch (data.type) {
            case 'market.tick':
              if (data.payload.symbol && data.payload.price) {
                setLivePrice(String(data.payload.symbol), Number(data.payload.price));
              }
              break;
            case 'trade.stream':
              addLiveEvent({ type: 'trade', payload: data.payload });
              break;
            case 'book.update':
              addLiveEvent({ type: 'book', payload: data.payload });
              break;
            case 'account.updated':
              if (data.payload) setAccount(data.payload as never);
              break;
            case 'position.updated':
              // Refresh positions via REST to get authoritative state
              queryClient.invalidateQueries({ queryKey: ['dashboard'] });
              addLiveEvent({ type: 'position', payload: data.payload });
              break;
            case 'agent.cycle':
              addLiveEvent({ type: 'cycle', payload: data.payload });
              queryClient.invalidateQueries({ queryKey: ['cycles'] });
              break;
            case 'risk.alert':
              addLiveEvent({ type: 'risk', payload: data.payload });
              break;
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [addLiveEvent, queryClient, setAccount, setLivePrice, setWsConnected]);
}
