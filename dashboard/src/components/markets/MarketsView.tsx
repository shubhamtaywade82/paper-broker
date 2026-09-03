import { useState } from 'react';
import { useStore, SUPPORTED_SYMBOLS, formatPrice, formatCurrency, formatQty } from '../../store/useStore';
import {
  useTickers,
  useOrderbook,
  useTrades,
  useKlines,
  useKlinesBefore,
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
  const { selectedSymbol, setSelectedSymbol, timeframe, setTimeframe, tickers, livePrice } = useStore();
  const [depthLimit, setDepthLimit] = useState<number>(10);
  const [beforeTs, setBeforeTs] = useState<number | null>(null);

  useTickers();
  const { data: orderbook } = useOrderbook(selectedSymbol, depthLimit);
  const { data: trades = [] } = useTrades(selectedSymbol);
  const { data: klines = [], isLoading: klinesLoading } = useKlines(selectedSymbol, timeframe, 100);
  const { data: olderKlines = [] } = useKlinesBefore(selectedSymbol, timeframe, beforeTs);

  const activeTicker = tickers[selectedSymbol];
  const activeLtp = livePrice[selectedSymbol] ?? activeTicker?.price ?? activeTicker?.markPrice ?? 0;

  // Merge older candles with current ones
  const allKlines = (() => {
    if (olderKlines.length === 0) return klines;
    const merged = [...olderKlines, ...klines];
    const seen = new Set<number>();
    return merged
      .filter((c) => {
        if (seen.has(c.openTime)) return false;
        seen.add(c.openTime);
        return true;
      })
      .sort((a, b) => a.openTime - b.openTime);
  })();

  const handleLoadMore = (oldestCandleTime: number) => {
    setBeforeTs(oldestCandleTime * 1000);
  };

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Top Watchlist Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {SUPPORTED_SYMBOLS.map((sym) => {
          const t = tickers[sym];
          const price = livePrice[sym] ?? t?.price ?? 0;
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
                {formatCurrency(price, sym)}
              </div>
              <div className={`text-[10px] font-bold mt-0.5 ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPos ? '+' : ''}{(t?.change24h || 0).toFixed(2)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Symbol Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Chart & Market Structure (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
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
                <span className="font-bold text-white">{formatCurrency(activeLtp, selectedSymbol)}</span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] block">24h High</span>
                <span className="font-bold text-gray-300">{formatCurrency(activeTicker?.high24h, selectedSymbol)}</span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] block">24h Low</span>
                <span className="font-bold text-gray-300">{formatCurrency(activeTicker?.low24h, selectedSymbol)}</span>
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
            candles={allKlines}
            symbol={selectedSymbol}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            onLoadMore={handleLoadMore}
            height={420}
            loading={klinesLoading && allKlines.length === 0}
          />
        </div>

        {/* Right: Order Book Depth & Recent Trades (1 col) */}
        <div className="space-y-4">
          {/* Order Book Depth Visualizer */}
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-[#1b2537] pb-2.5 mb-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-white uppercase text-xs">Order Book Depth</h3>
              </div>
              {/* Depth Selector */}
              <div className="flex items-center gap-1">
                {[5, 10, 20].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDepthLimit(d)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer transition ${
                      depthLimit === d
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#141d2e] text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const asks = (orderbook?.asks || []).slice(0, depthLimit);
              const bids = (orderbook?.bids || []).slice(0, depthLimit);
              const maxQty = Math.max(...asks.map(([_, q]) => q), ...bids.map(([_, q]) => q), 0.001);
              const rowCount = Math.max(asks.length, bids.length);
              const baseAsset = selectedSymbol.replace('USDT', '');

              return (
                <>
                  {/* Mid Price & Spread Header Bar */}
                  <div className="bg-[#080c14] py-1.5 px-3 rounded-lg border border-[#1b2537] flex items-center justify-between text-[11px] font-bold mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-mono">
                        {formatCurrency(activeLtp || orderbook?.last, selectedSymbol)}
                      </span>
                      <span className="text-[9px] text-gray-500 font-mono">
                        Spread: {formatCurrency(orderbook?.spread, selectedSymbol)}
                      </span>
                    </div>
                    <span className="text-emerald-400 text-[9px] font-bold">MID PRICE</span>
                  </div>

                  {/* Horizontal Column Headers: Bids (SIZE | PRICE) vs Asks (PRICE | SIZE) */}
                  <div className="grid grid-cols-2 gap-2 text-[9px] text-gray-500 pb-1.5 border-b border-[#1b2537] font-semibold">
                    <div className="flex justify-between px-1">
                      <span className="text-gray-400 font-bold">SIZE ({baseAsset})</span>
                      <span className="text-emerald-400 font-bold">BID</span>
                    </div>
                    <div className="flex justify-between px-1 border-l border-[#1b2537] pl-2">
                      <span className="text-red-400 font-bold">ASK</span>
                      <span className="text-gray-400 font-bold">SIZE ({baseAsset})</span>
                    </div>
                  </div>

                  {/* Side-by-side Depth Rows */}
                  <div className="space-y-0.5 text-[10px] mt-1 max-h-56 overflow-y-auto">
                    {rowCount === 0 ? (
                      <div className="text-center py-6 text-gray-500 text-[10px]">
                        Waiting for order book depth...
                      </div>
                    ) : (
                      Array.from({ length: rowCount }).map((_, idx) => {
                        const bid = bids[idx];
                        const ask = asks[idx];

                        return (
                          <div
                            key={idx}
                            className="grid grid-cols-2 gap-2 py-0.5 px-0.5 hover:bg-[#141d2e] rounded transition-colors font-mono"
                          >
                            {/* Left: Bid (SIZE | PRICE) - Bar grows from inside (right) to outside (left) */}
                            {bid ? (
                              <div className="flex justify-between relative px-1 items-center">
                                <div
                                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/15 rounded"
                                  style={{ width: `${Math.min(100, (bid[1] / maxQty) * 100)}%` }}
                                />
                                <span className="text-gray-300 relative z-10 text-[9px]">
                                  {bid[1].toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                </span>
                                <span className="text-emerald-400 font-bold relative z-10">
                                  {formatPrice(bid[0], selectedSymbol)}
                                </span>
                              </div>
                            ) : (
                              <div className="px-1" />
                            )}

                            {/* Right: Ask (PRICE | SIZE) - Bar grows from inside (left) to outside (right) */}
                            {ask ? (
                              <div className="flex justify-between relative px-1 items-center border-l border-[#1b2537] pl-2">
                                <div
                                  className="absolute left-0 top-0 bottom-0 bg-red-500/15 rounded"
                                  style={{ width: `${Math.min(100, (ask[1] / maxQty) * 100)}%` }}
                                />
                                <span className="text-red-400 font-bold relative z-10">
                                  {formatPrice(ask[0], selectedSymbol)}
                                </span>
                                <span className="text-gray-300 relative z-10 text-[9px]">
                                  {ask[1].toLocaleString('en-US', { maximumFractionDigits: 3 })}
                                </span>
                              </div>
                            ) : (
                              <div className="px-1 border-l border-[#1b2537] pl-2" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}
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
                  <span className="font-mono">{formatQty(t.qty, selectedSymbol)}</span>
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
