import { useEffect, useSyncExternalStore } from 'react';
import { wsManager, type WsStatus } from '../lib/wsConnection.js';
import { setupWsRouting } from '../lib/wsRouting.js';
import type { WsMessage } from '../lib/wsContracts.js';
import { useStore } from '../store/useStore.js';
import { useSystemStore } from '../stores/systemStore.js';

export function useWebSocket(): { status: WsStatus } {
  useEffect(() => {
    wsManager.connect();
    const cleanupRouting = setupWsRouting();
    const cleanupStatus = wsManager.onStatus((status) => {
      useStore.getState().setWsConnected(status === 'open');
      useSystemStore.getState().setSystem({
        engineRunning: status === 'open' || status === 'connecting',
      });
    });
    return () => {
      cleanupRouting();
      cleanupStatus();
    };
  }, []);

  const status = useWsStatus();
  return { status };
}

export function useWsStatus(): WsStatus {
  return useSyncExternalStore(
    (cb) => wsManager.onStatus(cb),
    () => wsManager.statusSnapshot
  );
}

export function useWsMessage(channel: string, handler: (m: WsMessage) => void): void {
  useEffect(() => {
    return wsManager.on(channel, handler);
  }, [channel, handler]);
}

export function useWsChannels(channels: string[]): void {
  useEffect(() => {
    wsManager.subscribe(channels);
  }, [channels.join(',')]);
}
