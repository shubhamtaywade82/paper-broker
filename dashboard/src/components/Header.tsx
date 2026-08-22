import { useStore } from '../store/useStore';
import { Activity, Wifi, WifiOff } from 'lucide-react';

export function Header() {
  const { wsConnected, account, livePrice } = useStore();

  // Show first symbol's price if available
  const prices = Object.entries(livePrice);
  const topPrice = prices.length > 0 ? prices[0] : null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#111827] border-b border-[#2d3a4f] flex items-center px-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
          <Activity className="w-5 h-5" />
        </div>
        <h1 className="text-base font-bold text-white tracking-wide">
          TradingAgents <span className="text-gray-400 font-normal">Crypto Desk</span>
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-6 text-xs font-mono">
        {topPrice && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">{topPrice[0]}:</span>
            <span className="text-amber-400 font-semibold">
              ${topPrice[1].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            {/* pulse dot to show live feed is active */}
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          </div>
        )}

        {account && (
          <div className="flex items-center gap-4">
            <span className="text-gray-400">
              Equity:{' '}
              <span className="text-white font-semibold">
                ${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </span>
            <span
              className={
                account.unrealizedPnl >= 0
                  ? 'text-emerald-400 font-semibold'
                  : 'text-red-400 font-semibold'
              }
            >
              PnL: {account.unrealizedPnl >= 0 ? '+' : ''}$
              {account.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {wsConnected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-400" />
          )}
          <span className="text-gray-400">
            {wsConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
    </header>
  );
}
