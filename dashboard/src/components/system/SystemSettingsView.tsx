import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useDashboard, useArmMode, useEngineControl } from '../../hooks/useApi';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  Settings,
  Shield,
  Server,
  Play,
  Square,
  PowerOff,
  CheckCircle2,
} from 'lucide-react';

export function SystemSettingsView() {
  const { operatingMode, liveArmed } = useStore();
  useDashboard();

  const armMode = useArmMode();
  const engineControl = useEngineControl();

  const [isArmModalOpen, setIsArmModalOpen] = useState(false);
  const [isKillSwitchModalOpen, setIsKillSwitchModalOpen] = useState(false);

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Header */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-white uppercase">System Health &amp; Operations</h2>
            <p className="text-gray-400 text-[11px]">
              Platform status, exchange provider health, and operational engine controls.
            </p>
          </div>
        </div>
      </div>

      {/* Engine Controls Grid */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <h3 className="font-bold text-white uppercase text-xs">Trading Engine Controls</h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => engineControl.mutate('start')}
            disabled={engineControl.isPending}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="w-4 h-4" /> Start Strategy Engine
          </button>

          <button
            onClick={() => engineControl.mutate('stop')}
            disabled={engineControl.isPending}
            className="flex items-center gap-2 bg-[#080c14] hover:bg-gray-800 text-gray-300 border border-[#1b2537] font-bold px-4 py-2 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            <Square className="w-4 h-4" /> Pause Engine
          </button>

          <button
            onClick={() => setIsKillSwitchModalOpen(true)}
            disabled={engineControl.isPending}
            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold px-4 py-2 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            <PowerOff className="w-4 h-4" /> Emergency Kill-Switch
          </button>
        </div>
      </div>

      {/* Operating Profile & Live Arm Gate */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            Execution Profile &amp; Live Arming Gate
          </h3>
          <span className="px-2.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold text-[10px] uppercase">
            TRADING_MODE: {operatingMode}
          </span>
        </div>

        <p className="text-gray-400 leading-relaxed">
          Operating profile is controlled via single selector flag. In live mode, execution orders are
          strictly blocked by the <code className="text-white">LiveTradingGuard</code> unless the armed state is explicitly unlocked.
        </p>

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={() => setIsArmModalOpen(true)}
            className={`px-4 py-2 rounded-xl font-bold transition-all cursor-pointer ${
              liveArmed
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-emerald-600 text-white hover:bg-emerald-500'
            }`}
          >
            {liveArmed ? 'Disarm Live Trading' : 'Arm Live Trading Gate'}
          </button>
          <span className="text-gray-500 text-[11px]">
            Current status: <strong className="text-white">{liveArmed ? 'ARMED' : 'DISARMED'}</strong>
          </span>
        </div>
      </div>

      {/* Provider Health Matrix */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
          <Server className="w-4 h-4 text-purple-400" />
          Provider Health &amp; Infrastructure Feeds
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#080c14] border border-[#1b2537] p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Binance Futures WS</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> ONLINE
              </span>
            </div>
            <p className="text-gray-500 text-[10px]">Primary market data stream • bookTicker &amp; markPrice</p>
          </div>

          <div className="bg-[#080c14] border border-[#1b2537] p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">CoinDCX Execution</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> READY
              </span>
            </div>
            <p className="text-gray-500 text-[10px]">Execution broker adapter &amp; market data supervisor fallback</p>
          </div>

          <div className="bg-[#080c14] border border-[#1b2537] p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Ollama SDK Runtime</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> ONLINE
              </span>
            </div>
            <p className="text-gray-500 text-[10px]">Local LLM runtime for dialectical multi-agent debate</p>
          </div>
        </div>
      </div>

      {/* Arm Mode Modal */}
      <ConfirmationModal
        isOpen={isArmModalOpen}
        title={liveArmed ? 'Disarm Live Trading' : 'Arm Live Trading Gate'}
        message={
          liveArmed
            ? 'Are you sure you want to disarm live execution? Orders will be blocked from reaching real exchange endpoints.'
            : 'WARNING: Arming live trading enables real exchange order submission via CoinDCXBroker when TRADING_MODE=live. Ensure risk parameters and balance are verified.'
        }
        confirmLabel={liveArmed ? 'Disarm' : 'Arm Live Execution'}
        confirmVariant={liveArmed ? 'warning' : 'danger'}
        isLoading={armMode.isPending}
        onConfirm={() => {
          armMode.mutate(undefined, {
            onSuccess: () => setIsArmModalOpen(false),
          });
        }}
        onCancel={() => setIsArmModalOpen(false)}
      />

      {/* Kill Switch Modal */}
      <ConfirmationModal
        isOpen={isKillSwitchModalOpen}
        title="Activate Kill Switch"
        message="This will immediately cancel all open orders across all markets and halt the trading engine."
        confirmLabel="Activate Kill Switch"
        confirmVariant="danger"
        isLoading={engineControl.isPending}
        onConfirm={() => {
          engineControl.mutate('kill-switch', {
            onSuccess: () => setIsKillSwitchModalOpen(false),
          });
        }}
        onCancel={() => setIsKillSwitchModalOpen(false)}
      />
    </div>
  );
}
