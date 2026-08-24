import { useState } from 'react';
import { useStore, type Order } from '../../store/useStore';
import {
  useDashboard,
  useOpenOrders,
  useCancelOrder,
  useCancelAllOrders,
  useEngineControl,
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
              {tab} {tab === 'positions' && `(${positions.length})`} {tab === 'orders' && `(${openOrders.length})`}
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

                        return (
                          <>
                            <td className="px-5 py-4 text-right text-gray-300">{qty}</td>
                            <td className="px-5 py-4 text-right text-gray-400">${entry.toFixed(2)}</td>
                            <td className="px-5 py-4 text-right text-white font-semibold">${mark.toFixed(2)}</td>
                            <td className="px-5 py-4 text-right text-amber-400">
                              {pos.liquidationPrice ? `$${pos.liquidationPrice.toFixed(2)}` : '—'}
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
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-8 text-center text-gray-400">
          <p>Order fill logs are recorded to the append-only SQLite journal.</p>
        </div>
      )}

      {/* Tab 4: Trade Journal */}
      {tradingTab === 'journal' && (
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-8 text-center text-gray-400">
          <p>Forensic trade journal records every closed position and R-multiple outcome.</p>
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
                <span className="font-bold text-white">${(selectedPosition.entryPrice ?? 0).toFixed(2)}</span>
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
                      <span className="font-bold text-white">${mark.toFixed(2)}</span>
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
