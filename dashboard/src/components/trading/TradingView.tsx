import { useState } from 'react';
import { useStore, formatCurrency, type Order } from '../../store/useStore';
import {
  useDashboard,
  useOpenOrders,
  useCancelOrder,
  useCancelAllOrders,
  useEngineControl,
  useFills,
  useJournal,
} from '../../hooks/useApi';
import { OrderModal } from '../common/OrderModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Trash2,
  AlertOctagon,
  Shield,
  X,
  Bot,
} from 'lucide-react';

export function TradingView() {
  const {
    positions,
    openOrders,
    selectedPosition,
    setSelectedPosition,
    tradingTab,
    setTradingTab,
    selectedSymbol,
    setActiveTab,
    livePrice,
  } = useStore();

  useDashboard();
  useOpenOrders();
  const { data: fills = [] } = useFills();
  const { data: journal = [] } = useJournal();

  const cancelOrder = useCancelOrder();
  const cancelAllOrders = useCancelAllOrders();
  const engineControl = useEngineControl();

  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isCancelAllModalOpen, setIsCancelAllModalOpen] = useState(false);
  const [isFlattenModalOpen, setIsFlattenModalOpen] = useState(false);

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Trading Header & Sub-tab navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0f1623] border border-[#1b2537] p-4 rounded-xl">
        <div className="flex items-center gap-2">
          {(['positions', 'orders', 'fills', 'journal'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTradingTab(tab)}
              className={`px-4 py-2 rounded-lg font-bold uppercase transition-all cursor-pointer ${
                tradingTab === tab
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                  : 'bg-[#080c14] text-gray-400 hover:text-white border border-[#1b2537]'
              }`}
            >
              {tab} {tab === 'positions' && `(${positions.length})`} {tab === 'orders' && `(${openOrders.length})`} {tab === 'fills' && `(${fills.length})`} {tab === 'journal' && `(${journal.length})`}
            </button>
          ))}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOrderModalOpen(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg font-bold transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Place Order</span>
          </button>

          <button
            onClick={() => setIsCancelAllModalOpen(true)}
            disabled={openOrders.length === 0}
            className="flex items-center gap-1.5 bg-[#080c14] hover:bg-gray-800 text-gray-300 border border-[#1b2537] px-3.5 py-2 rounded-lg font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Cancel All</span>
          </button>

          <button
            onClick={() => setIsFlattenModalOpen(true)}
            disabled={positions.length === 0}
            className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-3.5 py-2 rounded-lg font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>Emergency Flatten</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Positions Table */}
      {tradingTab === 'positions' && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
          {positions.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No active positions in the paper broker account. Place an order or trigger an agent cycle to open a position.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#080c14] text-gray-400 uppercase text-[10px] border-b border-[#1b2537]">
                  <tr>
                    <th className="px-5 py-3">Symbol</th>
                    <th className="px-5 py-3">Side</th>
                    <th className="px-5 py-3 text-right">Size</th>
                    <th className="px-5 py-3 text-right">Entry Price</th>
                    <th className="px-5 py-3 text-right">Mark Price</th>
                    <th className="px-5 py-3 text-right">Liq Price</th>
                    <th className="px-5 py-3 text-right">SL</th>
                    <th className="px-5 py-3 text-right">TP</th>
                    <th className="px-5 py-3 text-right">Unrealized PnL</th>
                    <th className="px-5 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2537]">
                  {positions.map((pos) => (
                    <tr
                      key={pos.symbol}
                      onClick={() => setSelectedPosition(pos)}
                      className="hover:bg-[#141d2e] transition cursor-pointer"
                    >
                      <td className="px-5 py-4 font-bold text-white flex items-center gap-2">
                        <span>{pos.symbol}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                            pos.side === 'LONG'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {pos.side === 'LONG' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {pos.side} {pos.leverage}x
                        </span>
                      </td>
                      {(() => {
                        const entry = pos.entryPrice ?? 0;
                        const qty = pos.quantity ?? 0;
                        const side = pos.side ?? 'LONG';
                        const mark = livePrice[pos.symbol] ?? pos.markPrice ?? entry;
                        const pnl = side === 'LONG' ? (mark - entry) * qty : (entry - mark) * qty;
                        // A reduce-only bracket only actually protects this position if its side
                        // can fill against it (SELL reduces LONG, BUY reduces SHORT) — a stale
                        // order left over from a prior direction on this symbol can never fire.
                        const protectiveSide = side === 'LONG' ? 'SELL' : 'BUY';
                        const slOrder = openOrders.find((o) => o.symbol === pos.symbol && o.type === 'STOP_MARKET' && o.reduceOnly && o.side === protectiveSide);
                        const tpOrder = openOrders.find((o) => o.symbol === pos.symbol && o.type === 'TAKE_PROFIT_MARKET' && o.reduceOnly && o.side === protectiveSide);

                        return (
                          <>
                            <td className="px-5 py-4 text-right text-gray-300">{qty}</td>
                            <td className="px-5 py-4 text-right text-gray-400">{formatCurrency(entry, pos.symbol)}</td>
                            <td className="px-5 py-4 text-right text-white font-semibold">{formatCurrency(mark, pos.symbol)}</td>
                            <td className="px-5 py-4 text-right text-amber-400">
                              {pos.liquidationPrice ? formatCurrency(pos.liquidationPrice, pos.symbol) : '—'}
                            </td>
                            <td className="px-5 py-4 text-right text-red-400">
                              {slOrder?.stopPrice ? formatCurrency(slOrder.stopPrice, pos.symbol) : '—'}
                            </td>
                            <td className="px-5 py-4 text-right text-emerald-400">
                              {tpOrder?.stopPrice ? formatCurrency(tpOrder.stopPrice, pos.symbol) : '—'}
                            </td>
                            <td
                              className={`px-5 py-4 text-right font-bold ${
                                pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                            </td>
                          </>
                        );
                      })()}
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPosition(pos);
                          }}
                          className="text-blue-400 hover:text-blue-300 font-bold px-2 py-1 bg-blue-500/10 rounded"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Orders Table */}
      {tradingTab === 'orders' && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
          {openOrders.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              No open orders currently pending in the order book.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#080c14] text-gray-400 uppercase text-[10px] border-b border-[#1b2537]">
                  <tr>
                    <th className="px-5 py-3">Order ID</th>
                    <th className="px-5 py-3">Symbol</th>
                    <th className="px-5 py-3">Side</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3 text-right">Price</th>
                    <th className="px-5 py-3 text-right">Quantity</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2537]">
                  {openOrders.map((ord: Order) => (
                    <tr key={ord.id} className="hover:bg-[#141d2e] transition">
                      <td className="px-5 py-3.5 font-mono text-gray-400 text-[11px]">{ord.id}</td>
                      <td className="px-5 py-3.5 font-bold text-white">{ord.symbol}</td>
                      <td className="px-5 py-3.5 font-bold">
                        <span className={ord.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
                          {ord.side}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-300">{ord.type}</td>
                      <td className="px-5 py-3.5 text-right text-white">
                        {ord.price ? `$${ord.price.toFixed(2)}` : 'MARKET'}
                      </td>
                      <td className="px-5 py-3.5 text-right text-gray-300">{ord.quantity}</td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 font-bold">
                          {ord.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => cancelOrder.mutate(ord.id)}
                          className="px-2.5 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 font-bold transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Fills History */}
      {tradingTab === 'fills' && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
          {fills.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <p>No fills recorded yet. Fills appear here as soon as an order executes.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#080c14] text-gray-400 uppercase text-[10px] border-b border-[#1b2537]">
                  <tr>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">Symbol</th>
                    <th className="px-4 py-2.5">Side</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5 text-right">Price</th>
                    <th className="px-4 py-2.5 text-right">Fee</th>
                    <th className="px-4 py-2.5 text-right">Realized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2537]">
                  {fills.map((f) => (
                    <tr key={f.id} className="hover:bg-[#141d2e] transition">
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(f.fillTsUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 font-bold text-white">{f.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          f.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {f.side}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{f.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-400">${f.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">${f.fee.toFixed(4)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${
                        f.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {f.realizedPnl !== 0 ? `${f.realizedPnl >= 0 ? '+' : ''}$${f.realizedPnl.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Trade Journal */}
      {tradingTab === 'journal' && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
          {journal.length === 0 ? (
            <div className="p-8 text-center text-gray-400 space-y-2">
              <p>No closed trades with a linked stop-loss yet.</p>
              <p className="text-gray-600 text-[11px]">
                R-multiple only computes when the closing fill can be traced back to the STOP_MARKET order placed
                alongside the entry (same signal). Manually-closed or bracket-less trades show a real realized PnL
                row but no R-multiple.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#080c14] text-gray-400 uppercase text-[10px] border-b border-[#1b2537]">
                  <tr>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">Symbol</th>
                    <th className="px-4 py-2.5">Side</th>
                    <th className="px-4 py-2.5 text-right">Qty</th>
                    <th className="px-4 py-2.5 text-right">Entry</th>
                    <th className="px-4 py-2.5 text-right">Exit</th>
                    <th className="px-4 py-2.5 text-right">Stop</th>
                    <th className="px-4 py-2.5 text-right">Realized PnL</th>
                    <th className="px-4 py-2.5 text-right">R-Multiple</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2537]">
                  {journal.map((j) => (
                    <tr key={j.id} className="hover:bg-[#141d2e] transition">
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(j.fillTsUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 font-bold text-white">{j.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          j.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {j.side}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{j.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-400">${j.entryPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-white">${j.exitPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-amber-400">
                        {j.stopPrice !== null ? `$${j.stopPrice.toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${j.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {j.realizedPnl >= 0 ? '+' : ''}${j.realizedPnl.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${
                        j.rMultiple === null ? 'text-gray-600' : j.rMultiple >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {j.rMultiple !== null ? `${j.rMultiple >= 0 ? '+' : ''}${j.rMultiple}R` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Position Detail Drawer */}
      {selectedPosition && (
        <div className="fixed inset-y-0 right-0 w-96 bg-[#0f1623] border-l border-[#1b2537] shadow-2xl z-50 p-6 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-[#1b2537] pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-white uppercase text-sm">
                  {selectedPosition.symbol} Position Detail
                </h3>
              </div>
              <button
                onClick={() => setSelectedPosition(null)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#080c14] rounded-xl p-4 border border-[#1b2537] space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Side &amp; Leverage</span>
                <span className="font-bold text-white">
                  {selectedPosition.side} ({selectedPosition.leverage}x)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Size</span>
                <span className="font-bold text-white">{selectedPosition.quantity ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Entry Price</span>
                <span className="font-bold text-white">{formatCurrency(selectedPosition.entryPrice, selectedPosition.symbol)}</span>
              </div>
              {(() => {
                const entry = selectedPosition.entryPrice ?? 0;
                const qty = selectedPosition.quantity ?? 0;
                const side = selectedPosition.side ?? 'LONG';
                const mark = livePrice[selectedPosition.symbol] ?? selectedPosition.markPrice ?? entry;
                const pnl = side === 'LONG' ? (mark - entry) * qty : (entry - mark) * qty;

                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Mark Price</span>
                      <span className="font-bold text-white">{formatCurrency(mark, selectedPosition.symbol)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Unrealized PnL</span>
                      <span
                        className={`font-bold ${
                          pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="space-y-2">
              <span className="text-[10px] text-gray-500 uppercase">Agent Trace Correlation</span>
              <button
                onClick={() => {
                  setSelectedPosition(null);
                  setActiveTab('agent');
                }}
                className="w-full flex items-center justify-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 font-bold py-2.5 rounded-xl cursor-pointer"
              >
                <Bot className="w-4 h-4" />
                <span>Open Agent Decision Trace</span>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[#1b2537]">
            <button
              onClick={() => setSelectedPosition(null)}
              className="w-full bg-[#1b2537] hover:bg-gray-700 text-white font-bold py-2.5 rounded-xl cursor-pointer"
            >
              Close Drawer
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <OrderModal
        isOpen={isOrderModalOpen}
        defaultSymbol={selectedSymbol}
        onClose={() => setIsOrderModalOpen(false)}
      />

      <ConfirmationModal
        isOpen={isCancelAllModalOpen}
        title="Cancel All Orders"
        message="Are you sure you want to cancel all open orders across all markets?"
        confirmLabel="Cancel All Orders"
        confirmVariant="warning"
        isLoading={cancelAllOrders.isPending}
        onConfirm={() => {
          cancelAllOrders.mutate(undefined, {
            onSuccess: () => setIsCancelAllModalOpen(false),
          });
        }}
        onCancel={() => setIsCancelAllModalOpen(false)}
      />

      <ConfirmationModal
        isOpen={isFlattenModalOpen}
        title="Emergency Flatten Positions"
        message="This will immediately close all active positions at market price and cancel all pending orders. Are you sure you want to emergency flatten?"
        confirmLabel="Emergency Flatten"
        confirmVariant="danger"
        isLoading={engineControl.isPending}
        onConfirm={() => {
          engineControl.mutate('kill-switch', {
            onSuccess: () => setIsFlattenModalOpen(false),
          });
        }}
        onCancel={() => setIsFlattenModalOpen(false)}
      />
    </div>
  );
}
