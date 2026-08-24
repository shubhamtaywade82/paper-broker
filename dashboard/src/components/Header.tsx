import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useTriggerCycle, useEngineControl } from '../hooks/useApi';
import { ConfirmationModal } from './common/ConfirmationModal';
import { OrderModal } from './common/OrderModal';
import {
  Activity,
  Wifi,
  WifiOff,
  Shield,
  Play,
  Plus,
  PowerOff,
} from 'lucide-react';

export function Header() {
  const {
    wsConnected,
    account,
    livePrice,
    operatingMode,
    liveArmed,
    selectedSymbol,
  } = useStore();

  const [isKillSwitchOpen, setIsKillSwitchOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);

  const triggerCycle = useTriggerCycle();
  const engineControl = useEngineControl();

  const prices = Object.entries(livePrice);
  const topPrices = prices.slice(0, 3);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-[#0f1623] border-b border-[#1b2537] flex items-center justify-between px-6 font-mono text-xs select-none">
        {/* Brand & System Profile */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-sm">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="font-black text-sm text-white tracking-wider flex items-center gap-1.5">
                <span>NEMESIS AI</span>
                <span className="text-[10px] text-gray-500 font-normal">TERMINAL</span>
              </div>
              <p className="text-[10px] text-gray-400">Autonomous Trading OS</p>
            </div>
          </div>

          {/* Operating Profile Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#080c14] border border-[#1b2537]">
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span
              className={`font-bold uppercase text-[10px] ${
                operatingMode === 'live'
                  ? 'text-red-400'
                  : operatingMode === 'shadow'
                  ? 'text-amber-400'
                  : 'text-blue-400'
              }`}
            >
              {operatingMode}
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                liveArmed
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-gray-800 text-gray-400'
              }`}
            >
              {liveArmed ? 'ARMED' : 'DISARMED'}
            </span>
          </div>
        </div>

        {/* Live Prices Ticker */}
        <div className="hidden lg:flex items-center gap-5 text-[11px]">
          {topPrices.map(([sym, price]) => (
            <div key={sym} className="flex items-center gap-2">
              <span className="text-gray-400">{sym}:</span>
              <span className="text-amber-400 font-bold">
                ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
          ))}
        </div>

        {/* Quick Actions & Account Metrics */}
        <div className="flex items-center gap-4">
          {/* Account Metrics */}
          {account && (
            <div className="hidden md:flex items-center gap-4 bg-[#080c14] px-3.5 py-1.5 rounded-xl border border-[#1b2537]">
              <div>
                <span className="text-gray-500 text-[10px] uppercase block">Equity</span>
                <span className="text-white font-bold">
                  ${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="border-l border-[#1b2537] pl-3">
                <span className="text-gray-500 text-[10px] uppercase block">PnL</span>
                <span
                  className={`font-bold ${
                    account.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {account.unrealizedPnl >= 0 ? '+' : ''}$
                  {account.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* Quick Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsOrderModalOpen(true)}
              className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/40 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Order</span>
            </button>

            <button
              onClick={() => triggerCycle.mutate({ symbol: selectedSymbol })}
              disabled={triggerCycle.isPending}
              className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{triggerCycle.isPending ? 'Debating...' : 'Cycle'}</span>
            </button>

            <button
              onClick={() => setIsKillSwitchOpen(true)}
              className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
              title="Emergency Kill-Switch"
            >
              <PowerOff className="w-4 h-4" />
            </button>
          </div>

          {/* WebSocket Status */}
          <div className="flex items-center gap-1.5">
            {wsConnected ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-400" />
            )}
          </div>
        </div>
      </header>

      {/* Kill-Switch Confirmation Modal */}
      <ConfirmationModal
        isOpen={isKillSwitchOpen}
        title="Activate Kill Switch"
        message="This will immediately cancel all open orders across all markets and halt the trading engine. Are you sure you want to trigger the emergency kill switch?"
        confirmLabel="Activate Kill Switch"
        confirmVariant="danger"
        isLoading={engineControl.isPending}
        onConfirm={() => {
          engineControl.mutate('kill-switch', {
            onSuccess: () => setIsKillSwitchOpen(false),
          });
        }}
        onCancel={() => setIsKillSwitchOpen(false)}
      />

      {/* Order Entry Modal */}
      <OrderModal
        isOpen={isOrderModalOpen}
        defaultSymbol={selectedSymbol}
        onClose={() => setIsOrderModalOpen(false)}
      />
    </>
  );
}
