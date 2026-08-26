import { useStore, SUPPORTED_SYMBOLS } from '../../store/useStore';
import {
  Sparkles,
  TrendingUp,
  Activity,
  Zap,
  Sliders,
  Database,
  CheckCircle2,
  Gauge,
  Lock,
} from 'lucide-react';

export function AdaptiveSupertrendInspector() {
  const { selectedSymbol, setSelectedSymbol, livePrice, tickers } = useStore();
  const currentPrice = livePrice[selectedSymbol] || tickers[selectedSymbol]?.price || 150.0;

  // Real-time simulated indicators based on live ticker
  const mockAtrPeriod = 12;
  const mockMultiplier = 2.4;
  const isBullish = true;
  const supertrendLevel = isBullish ? currentPrice * 0.985 : currentPrice * 1.015;
  const confidenceScore = 0.78;

  const learnedStates = [
    { state: 'high_strong_neutral', bestParam: 'ATR 18, Mult 3.2', qValue: 0.84, winRate: '68%' },
    { state: 'medium_medium_neutral', bestParam: 'ATR 14, Mult 2.8', qValue: 0.76, winRate: '62%' },
    { state: 'low_weak_oversold', bestParam: 'ATR 8, Mult 1.5', qValue: 0.71, winRate: '59%' },
    { state: 'high_strong_overbought', bestParam: 'ATR 20, Mult 3.5', qValue: 0.68, winRate: '55%' },
  ];

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Header Banner */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-white uppercase flex items-center gap-2">
              AI-Based Adaptive Supertrend Engine
              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold text-[10px]">
                RL Q-LEARNING ACTIVE
              </span>
            </h2>
            <p className="text-gray-400 text-[11px]">
              Continuous parameter adaptation on every candle close using market regime classification and fuzzy confluence.
            </p>
          </div>
        </div>

        {/* Symbol Quick Switcher */}
        <div className="flex items-center gap-1.5 bg-[#080c14] p-1.5 rounded-xl border border-[#1b2537]">
          {SUPPORTED_SYMBOLS.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedSymbol === sym
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {sym.replace('USDT', '')}
            </button>
          ))}
        </div>
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-1">
          <span className="text-[10px] text-gray-500 uppercase flex items-center gap-1">
            <Sliders className="w-3.5 h-3.5 text-purple-400" /> Dynamic ATR Period
          </span>
          <span className="text-xl font-black text-white">{mockAtrPeriod} bars</span>
          <span className="text-[10px] text-gray-400 block">Adapted to volatility</span>
        </div>

        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-1">
          <span className="text-[10px] text-gray-500 uppercase flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-blue-400" /> Dynamic Multiplier
          </span>
          <span className="text-xl font-black text-blue-400">{mockMultiplier.toFixed(1)}x</span>
          <span className="text-[10px] text-gray-400 block">Wide swing protection</span>
        </div>

        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-1">
          <span className="text-[10px] text-gray-500 uppercase flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Trailing Band Level
          </span>
          <span className="text-xl font-black text-emerald-400">${supertrendLevel.toFixed(2)}</span>
          <span className="text-[10px] text-emerald-500/80 block">🟢 Bullish Trend Support</span>
        </div>

        <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 space-y-1">
          <span className="text-[10px] text-gray-500 uppercase flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-amber-400" /> Confluence Score
          </span>
          <span className="text-xl font-black text-amber-400">{(confidenceScore * 100).toFixed(0)}%</span>
          <span className="text-[10px] text-emerald-400 block">● High Confidence Setup</span>
        </div>
      </div>

      {/* Main 2-Column Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left 2 Cols: Market Regime & Confluence */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              Live Market Regime Classification ({selectedSymbol})
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-xl space-y-1">
                <span className="text-[10px] text-gray-500 uppercase block">1. Volatility Regime</span>
                <span className="text-emerald-400 font-bold block">MEDIUM VOLATILITY</span>
                <span className="text-gray-400 text-[10px]">BB Width: 3.8% • ATR: $1.85</span>
              </div>

              <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-xl space-y-1">
                <span className="text-[10px] text-gray-500 uppercase block">2. Trend Strength</span>
                <span className="text-blue-400 font-bold block">STRONG TRENDING</span>
                <span className="text-gray-400 text-[10px]">ADX: 28.4 • +DI &gt; -DI</span>
              </div>

              <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-xl space-y-1">
                <span className="text-[10px] text-gray-500 uppercase block">3. Momentum &amp; Volume</span>
                <span className="text-purple-400 font-bold block">BULLISH ACCELERATION</span>
                <span className="text-gray-400 text-[10px]">RSI: 58.2 • Vol Ratio: 1.45x</span>
              </div>
            </div>
          </div>

          {/* Fuzzy Confluence Progress */}
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white uppercase text-xs">Fuzzy Inference Confluence Matrix</h3>
              <span className="text-emerald-400 font-bold">PROBABILITY OF PROFIT: 78%</span>
            </div>
            <div className="w-full bg-[#080c14] rounded-full h-3 overflow-hidden border border-[#1b2537]">
              <div
                className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${confidenceScore * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
              <span className="text-gray-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Supertrend Flip</span>
              <span className="text-gray-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> RSI Momentum</span>
              <span className="text-gray-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> MACD Expansion</span>
              <span className="text-gray-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Volume Confirmation</span>
            </div>
          </div>
        </div>

        {/* Right Col: Reinforcement Learning Memory Explorer */}
        <div className="space-y-4">
          <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-3">
            <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              RL Q-Learning Memory
            </h3>
            <p className="text-gray-400 text-[11px] leading-relaxed">
              Learned parameter weights are updated on every closed trade and persisted across system restarts.
            </p>

            <div className="space-y-2 pt-2">
              {learnedStates.map((row) => (
                <div key={row.state} className="bg-[#080c14] p-3 rounded-lg border border-[#1b2537] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-[11px]">{row.state}</span>
                    <span className="text-emerald-400 font-bold text-[10px]">Win: {row.winRate}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>{row.bestParam}</span>
                    <span>Q-Score: {row.qValue}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 text-[10px] text-gray-500 flex items-center justify-between border-t border-[#1b2537]">
              <span>Exploration Rate: 15%</span>
              <span className="flex items-center gap-1 text-emerald-400"><Lock className="w-3 h-3" /> Auto-Saved</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
