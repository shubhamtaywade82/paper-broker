import { wsManager } from './wsConnection.js';
import { useTradingStore } from '../stores/tradingStore.js';
import { useSystemStore } from '../stores/systemStore.js';
import { useAutonomousStore } from '../stores/autonomousStore.js';
import { useStore } from '../store/useStore.js';

/**
 * Wire every backend WebSocket broadcast into the appropriate Zustand store.
 *
 * Backend message shape: `{ type: '<event>', payload: {...}, timestampUtc }`.
 * The discriminated union in `wsContracts.ts` narrows `payload` per `type`,
 * so each case below sees a typed payload.
 *
 * Autonomous agent events (8 types) all flow into `useAutonomousStore`,
 * which keeps bounded ring buffers per event kind so the dashboard panel
 * can render a live picture of the agent's brain activity.
 */
export function setupWsRouting(): () => void {
  return wsManager.on('*', (m) => {
    switch (m.type) {
      // --- Market Data ---------------------------------------------------
      case 'market.tick':
        useStore.getState().setLivePrice(m.payload.symbol, m.payload.price);
        break;
      case 'kline.closed':
        useStore.getState().setClosedCandle(m.payload);
        break;

      // --- Trading -------------------------------------------------------
      case 'position.updated':
        useTradingStore.getState().upsertPosition(m.payload);
        break;
      case 'order.updated':
        useTradingStore.getState().upsertOrder(m.payload);
        break;
      case 'signal.created':
        useTradingStore.getState().pushSignal(m.payload);
        break;
      case 'account.reset':
        useTradingStore.getState().reset();
        break;

      // --- System --------------------------------------------------------
      case 'incident.alert':
        useSystemStore.getState().setSystem({
          incidentCount: useSystemStore.getState().incidentCount + 1,
        });
        break;

      // --- Debate pipeline ----------------------------------------------
      // liveEvents is the generic feed behind the live transcript, the
      // Decision Pipeline stage rail and ActivityView. Steps are stored under
      // the underscore form because both consumers already match on it.
      case 'agent.step':
        useStore.getState().addLiveEvent({ type: 'agent_step', payload: m.payload });
        break;
      case 'agent.cycle':
        useStore.getState().addLiveEvent({ type: 'agent.cycle', payload: m.payload });
        break;

      // --- Autonomous agent (8 event types) ------------------------------
      case 'agent.autonomous.cycle':
        useAutonomousStore.getState().pushCycle(m.payload);
        // The cycle summary carries the current health snapshot inline —
        // sync the standalone health field too so the brain-module card
        // updates on every cycle, not just on dedicated health broadcasts.
        useAutonomousStore.getState().setHealth(m.payload.health);
        break;
      case 'agent.autonomous.forming':
        useAutonomousStore.getState().pushForming(m.payload);
        break;
      case 'agent.autonomous.regime':
        useAutonomousStore.getState().pushRegime(m.payload);
        break;
      case 'agent.autonomous.signal':
        useAutonomousStore.getState().pushSignal(m.payload);
        break;
      case 'agent.autonomous.rejected':
        useAutonomousStore.getState().pushRejection(m.payload);
        break;
      case 'agent.autonomous.circuit_breaker':
        useAutonomousStore.getState().setCircuitBreaker(m.payload);
        break;
      case 'agent.autonomous.health':
        useAutonomousStore.getState().setHealth(m.payload);
        break;
      case 'agent.autonomous.exit':
        useAutonomousStore.getState().pushExit(m.payload);
        break;
      case 'agent.autonomous.learning':
        useAutonomousStore.getState().pushLearning(m.payload);
        break;

      // Other event types (market.tick, mode.changed, kill_switch.activated,
      // reconciliation.report, strategy.performance, setup.performance,
      // trailing.stop, etc.) are not consumed by the new Zustand stores yet.
      // They're handled by the legacy `useStore` (see store/useStore.ts) via
      // its own wsManager.on('*') subscription in hooks/useWebSocket.ts.
      default:
        break;
    }
  });
}
