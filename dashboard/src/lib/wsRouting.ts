import { wsManager } from './wsConnection.js';
import { useTradingStore } from '../stores/tradingStore.js';
import { useSystemStore } from '../stores/systemStore.js';

export function setupWsRouting(): () => void {
  return wsManager.on('*', (m) => {
    switch (m.channel) {
      case 'position.updated':
        useTradingStore.getState().upsertPosition(m.data);
        break;
      case 'order.updated':
        useTradingStore.getState().upsertOrder(m.data);
        break;
      case 'signal.created':
        useTradingStore.getState().pushSignal(m.data);
        break;
      case 'incident.alert':
        useSystemStore.getState().setSystem({
          incidentCount: useSystemStore.getState().incidentCount + 1,
        });
        break;
    }
  });
}
