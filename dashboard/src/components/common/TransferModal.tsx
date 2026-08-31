import React, { useState } from 'react';
import { useWallets, useTransferFunds, useDashboard } from '../../hooks/useApi';
import { formatCurrency, formatPrice } from '../../store/useStore';
import { ArrowRightLeft, X } from 'lucide-react';

export interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFrom?: 'SPOT' | 'FUTURES' | 'OPTIONS' | 'EARN';
  defaultTo?: 'SPOT' | 'FUTURES' | 'OPTIONS' | 'EARN';
}

const PRODUCTS = [
  { id: 'FUTURES', label: 'Futures Wallet' },
  { id: 'SPOT', label: 'Spot Wallet' },
  { id: 'OPTIONS', label: 'Options Wallet' },
  { id: 'EARN', label: 'Earn Wallet' },
] as const;

export function TransferModal({
  isOpen,
  onClose,
  defaultFrom = 'FUTURES',
  defaultTo = 'SPOT',
}: TransferModalProps) {
  const [fromProduct, setFromProduct] = useState<'FUTURES' | 'SPOT' | 'OPTIONS' | 'EARN'>(defaultFrom);
  const [toProduct, setToProduct] = useState<'FUTURES' | 'SPOT' | 'OPTIONS' | 'EARN'>(defaultTo);
  const [amount, setAmount] = useState('');
  const [currency] = useState('USDT');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: walletsData } = useWallets();
  const transferFunds = useTransferFunds();
  useDashboard();

  if (!isOpen) return null;

  const wallets = walletsData?.wallets ?? [];
  const fromWallet = wallets.find((w) => w.productType === fromProduct);
  const availableBalance = fromWallet?.free ?? 0;

  const handleSwap = () => {
    const temp = fromProduct;
    setFromProduct(toProduct);
    setToProduct(temp);
  };

  const handleMax = () => {
    if (availableBalance > 0) {
      setAmount(String(availableBalance));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const transferAmount = parseFloat(amount);
    if (!transferAmount || transferAmount <= 0) {
      setErrorMsg('Please enter a valid amount');
      return;
    }
    if (transferAmount > availableBalance) {
      setErrorMsg(`Insufficient funds in ${fromProduct}. Max available: $${formatPrice(availableBalance)}`);
      return;
    }
    if (fromProduct === toProduct) {
      setErrorMsg('Source and destination wallets must be different');
      return;
    }

    transferFunds.mutate(
      {
        fromProduct,
        toProduct,
        currency,
        amount: transferAmount,
      },
      {
        onSuccess: () => {
          setAmount('');
          onClose();
        },
        onError: (err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Transfer failed');
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 font-mono select-none">
      <div className="bg-[#111827] border border-[#2d3a4f] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2d3a4f] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase">Internal Transfer</h3>
              <p className="text-[10px] text-gray-400">Instant multi-product balance settlement</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Transfer Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* From / To Selectors */}
          <div className="bg-[#080c14] border border-[#1b2537] rounded-xl p-3 space-y-3">
            <div>
              <label className="block text-[10px] text-gray-500 uppercase font-bold mb-1">
                From Wallet
              </label>
              <select
                value={fromProduct}
                onChange={(e) => setFromProduct(e.target.value as typeof fromProduct)}
                className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white font-bold cursor-pointer"
              >
                {PRODUCTS.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === toProduct}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleSwap}
                className="p-1.5 rounded-lg bg-[#141d2e] border border-[#2d3a4f] text-gray-400 hover:text-white transition-colors cursor-pointer"
                title="Swap source and destination"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 uppercase font-bold mb-1">
                To Wallet
              </label>
              <select
                value={toProduct}
                onChange={(e) => setToProduct(e.target.value as typeof toProduct)}
                className="w-full bg-[#111827] border border-[#2d3a4f] rounded-lg px-3 py-2 text-white font-bold cursor-pointer"
              >
                {PRODUCTS.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === fromProduct}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-gray-400">Transfer Amount ({currency})</span>
              <span className="text-gray-400">
                Available:{' '}
                <span className="text-white font-bold font-mono">
                  {formatCurrency(availableBalance)}
                </span>
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-[#080c14] border border-[#2d3a4f] rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleMax}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-[10px] font-bold cursor-pointer"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Error display */}
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-red-400 text-[11px]">
              {errorMsg}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={transferFunds.isPending}
              className="px-5 py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all cursor-pointer disabled:opacity-50"
            >
              {transferFunds.isPending ? 'Transferring...' : 'Confirm Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
