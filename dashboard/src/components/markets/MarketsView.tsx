import { useStore, SUPPORTED_SYMBOLS, formatPrice, formatCurrency } from '../../store/useStore';
import {
  useTickers,
  useOrderbook,
  useTrades,
  useKlines,
} from '../../hooks/useApi';
import { TradingChart } from '../charts/TradingChart';
import {
  TrendingUp,
  TrendingDown,
  Layers,
  ArrowDownUp,
  Activity,
} from 'lucide-react';

export function MarketsView() {
  const { selectedSymbol, setSelectedSymbol, timeframe, setTimeframe, tickers } = useStore();

  useTickers();
  const { data: orderbook } = useOrderbook(selectedSymbol);
  const { data: trades = [] } = useTrades(selectedSymbol);
  const { data: klines = [], isLoading: klinesLoading } = useKlines(selectedSymbol, timeframe, 100);

  const activeTicker = tickers[selectedSymbol];

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Top Watchlist Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {SUPPORTED_SYMBOLS.map((sym) => {
          const t = tickers[sym];
          const isSelected = selectedSymbol === sym;
          const isPos = (t?.change24h || 0) >= 0;

          return (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                isSelected
                  ? 'bg-blue-600/15 border-blue-500/50 shadow-lg shadow-blue-900/20'
                  : 'bg-[#0f1623] border-[#1b2537] hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-white text-xs">{sym}</span>
                {isPos ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                )}
              </div>
              <div className="text-sm font-black text-white">
                ${(t?.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </div>
              <div className={`text-[10px] font-bold mt-0.5 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPos ? '+' : ''}{(t?.change24h || 0).toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Symbol Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left: Chart & Market Structure (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Active Symbol Header */}
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-white">{selectedSymbol}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">
                PERPETUAL
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-[11px]">
              <div>
                <span className="text-gray-500 text-[10px] block">Mark Price</span>
                <span className="font-bold text-white">${activeTicker?.markPrice || activeTicker?.price || 0}</span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] block">24h High</span>
                <span className="font-bold text-gray-300">${activeTicker?.high24h || 0}</span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] block">24h Low</span>
                <span className="font-bold text-gray-300">${activeTicker?.low24h || 0}</span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] block">Funding Rate</span>
                <span className="font-bold text-amber-400">
                  {((activeTicker?.fundingRate || 0.0001) * 100).toFixed(4)}%
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Chart */}
          <TradingChart
            candles={klines}
            symbol={selectedSymbol}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            height={420}
            loading={klinesLoading && klines.length === 0}
          />
        </div>

        {/* Right: Order Book Depth & Recent Trades (1 col) */}
        <div className="space-y-4">
          {/* Order Book Depth Visualizer */}
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-[#1b2537] pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-white uppercase text-xs">Order Book Depth</h3>
              </div>
              <span className="text-[10px] text-gray-500">
                Spread: {formatCurrency(orderbook?.spread, selectedSymbol)}
              </span>
            </div>

            {/* Asks (Sells) */}
            <div className="space-y-1 text-[10px] mb-2">
              {(orderbook?.asks || []).slice(0, 5).reverse().map(([p, q], idx) => (
                <div key={idx} className="flex justify-between relative py-0.5 px-1">
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-red-500/10 rounded"
                    style={{ width: `${Math.min(100, (q / 50) * 100)}%` }}
                  />
                  <span className="text-red-400 font-bold relative z-10">${formatPrice(p, selectedSymbol)}</span>
                  <span className="text-gray-400 relative z-10">{q.toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Mid Price Spread Bar */}
            <div className="bg-[#080c14] py-1.5 px-3 rounded-lg border border-[#1b2537] flex items-center justify-between text-[11px] font-bold my-1">
              <span className="text-white">{formatCurrency(activeTicker?.price || orderbook?.last, selectedSymbol)}</span>
              <span className="text-emerald-400 text-[10px]">MID PRICE</span>
            </div>

            {/* Bids (Buys) */}
            <div className="space-y-1 text-[10px] mt-2">
              {(orderbook?.bids || []).slice(0, 5).map(([p, q], idx) => (
                <div key={idx} className="flex justify-between relative py-0.5 px-1">
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 rounded"
                    style={{ width: `${Math.min(100, (q / 50) * 100)}%` }}
                  />
                  <span className="text-emerald-400 font-bold relative z-10">${formatPrice(p, selectedSymbol)}</span>
                  <span className="text-gray-400 relative z-10">{q.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Trades Stream */}
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4">
            <div className="flex items-center justify-between border-b border-[#1b2537] pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <ArrowDownUp className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-white uppercase text-xs">Recent Trades</h3>
              </div>
              <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            </div>

            <div className="space-y-1.5 text-[10px] max-h-48 overflow-y-auto">
              {trades.slice(0, 8).map((t, idx) => (
                <div key={idx} className="flex items-center justify-between py-0.5 text-gray-300">
                  <span className={t.isBuyerMaker ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
                    ${formatPrice(t.price, selectedSymbol)}
                  </span>
                  <span>{t.qty.toFixed(2)}</span>
                  <span className="text-gray-500">
                    {new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
