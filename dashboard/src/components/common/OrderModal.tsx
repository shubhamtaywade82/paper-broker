import { useState } from 'react';
import { useCreateOrder } from '../../hooks/useApi';
import { X, Send } from 'lucide-react';

export interface OrderModalProps {
  isOpen: boolean;
  defaultSymbol?: string;
  onClose: () => void;
}

export function OrderModal({ isOpen, defaultSymbol = 'SOLUSDT', onClose }: OrderModalProps) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET'>('LIMIT');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [leverage, setLeverage] = useState('5');
  const [reduceOnly, setReduceOnly] = useState(false);

  const createOrder = useCreateOrder();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) return;

    createOrder.mutate(
      {
        symbol,
        side,
        type,
        quantity: qty,
        price: price ? parseFloat(price) : undefined,
        stopPrice: stopPrice ? parseFloat(stopPrice) : undefined,
        leverage: leverage ? parseInt(leverage, 10) : undefined,
        reduceOnly,
      },
      {
        onSuccess: () => {
          onClose();
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 font-mono">
      <div className="bg-[#111827] border border-[#2d3a4f] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#2d3a4f] pb-3">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white uppercase">New Order Execution</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Side Selector */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSide('BUY')}
              className={`py-2 rounded-lg font-bold transition-all cursor-pointer ${
                side === 'BUY'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                  : 'bg-[#1a2332] text-gray-400 hover:text-white'
              }`}
            >
              BUY / LONG
            </button>
            <button
              type="button"
              onClick={() => setSide('SELL')}
              className={`py-2 rounded-lg font-bold transition-all cursor-pointer ${
                side === 'SELL'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                  : 'bg-[#1a2332] text-gray-400 hover:text-white'
              }`}
            >
              SELL / SHORT
            </button>
          </div>

          {/* Symbol & Order Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 text-[11px] mb-1">Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white"
              >
                <option value="SOLUSDT">SOLUSDT</option>
                <option value="BTCUSDT">BTCUSDT</option>
                <option value="ETHUSDT">ETHUSDT</option>
                <option value="BNBUSDT">BNBUSDT</option>
                <option value="XRPUSDT">XRPUSDT</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 text-[11px] mb-1">Order Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white"
              >
                <option value="LIMIT">LIMIT</option>
                <option value="MARKET">MARKET</option>
                <option value="STOP_MARKET">STOP MARKET</option>
                <option value="TAKE_PROFIT_MARKET">TAKE PROFIT</option>
              </select>
            </div>
          </div>

          {/* Quantity & Leverage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-gray-400 text-[11px] mb-1">Quantity</label>
              <input
                type="number"
                step="any"
                min="0.0001"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-[11px] mb-1">Leverage</label>
              <input
                type="number"
                min="1"
                max="20"
                value={leverage}
                onChange={(e) => setLeverage(e.target.value)}
                className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          {/* Limit Price if LIMIT */}
          {type === 'LIMIT' && (
            <div>
              <label className="block text-gray-400 text-[11px] mb-1">Limit Price ($)</label>
              <input
                type="number"
                step="any"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white"
                placeholder="0.00"
              />
            </div>
          )}

          {/* Stop Price if STOP */}
          {(type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET') && (
            <div>
              <label className="block text-gray-400 text-[11px] mb-1">Trigger Price ($)</label>
              <input
                type="number"
                step="any"
                required
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                className="w-full bg-[#1a2332] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white"
                placeholder="0.00"
              />
            </div>
          )}

          {/* Reduce-Only checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="reduceOnly"
              checked={reduceOnly}
              onChange={(e) => setReduceOnly(e.target.checked)}
              className="rounded bg-[#1a2332] border-[#2d3a4f] text-blue-500 focus:ring-0"
            />
            <label htmlFor="reduceOnly" className="text-gray-400 text-[11px]">
              Reduce-Only (close position only)
            </label>
          </div>

          {createOrder.isError && (
            <p className="text-red-400 text-[11px]">
              {(createOrder.error as Error).message}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createOrder.isPending}
              className={`px-5 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                side === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              {createOrder.isPending ? 'Submitting...' : `Submit ${side} Order`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
