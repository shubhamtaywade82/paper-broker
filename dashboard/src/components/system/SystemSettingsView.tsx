import { useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  useDashboard,
  useArmMode,
  useDisarmMode,
  useEngineControl,
  useProviderHealth,
  useSetAggressiveMode,
  useTriggerEvaluation,
  useAgentPoolConfig,
  useResetAccount,
  type ProviderHealthState,
} from '../../hooks/useApi';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  Settings,
  Shield,
  Server,
  Play,
  Square,
  PowerOff,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Zap,
  Lock,
  Unlock,
  AlertTriangle,
  Cpu,
  Cloud,
  Key,
  Sparkles,
  Database,
  Layers,
  RotateCcw,
} from 'lucide-react';

function errorMessage(err: unknown): string | null {
  return err instanceof Error ? err.message : null;
}

function ProviderStatusBadge({ health }: { health?: ProviderHealthState }) {
  if (!health) {
    return (
      <span className="text-gray-500 font-bold flex items-center gap-1">
        <HelpCircle className="w-3.5 h-3.5" /> UNKNOWN
      </span>
    );
  }
  const ok = health.status === 'HEALTHY' || health.status === 'RECOVERING';
  return (
    <span className={`font-bold flex items-center gap-1 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {health.status}
    </span>
  );
}

export function SystemSettingsView() {
  const { operatingMode, liveArmed, aggressiveMode } = useStore();
  const { data: dashboardData } = useDashboard();
  const { data: providerHealth } = useProviderHealth();
  const { data: agentPool } = useAgentPoolConfig();

  const armMode = useArmMode();
  const disarmMode = useDisarmMode();
  const engineControl = useEngineControl();
  const setAggressive = useSetAggressiveMode();
  const triggerEval = useTriggerEvaluation();
  const resetAccount = useResetAccount();

  const engineRunning = dashboardData?.engineRunning ?? false;

  const [isArmModalOpen, setIsArmModalOpen] = useState(false);
  const [isDisarmModalOpen, setIsDisarmModalOpen] = useState(false);
  const [isKillSwitchModalOpen, setIsKillSwitchModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

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
              Platform operating mode, execution profile, live arm gate, and exchange infrastructure.
            </p>
          </div>
        </div>
      </div>

      {/* Operating Mode Showcase Banner */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className={`w-5 h-5 ${operatingMode === 'live' ? 'text-red-400' : operatingMode === 'shadow' ? 'text-amber-400' : 'text-emerald-400'}`} />
            <h3 className="font-bold text-white uppercase text-sm">Active Execution Profile</h3>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${
                operatingMode === 'live'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : operatingMode === 'shadow'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              }`}
            >
              {operatingMode === 'paper' && '🟢 PAPER TRADING ACTIVE'}
              {operatingMode === 'shadow' && '🟡 SHADOW MODE (READ-ONLY)'}
              {operatingMode === 'live' && (liveArmed ? '🔴 LIVE REAL ORDERS ARMED' : '🛡️ LIVE MODE (DISARMED)')}
            </span>
          </div>
        </div>

        {/* Mode Details Box */}
        {operatingMode === 'paper' && (
          <div className="p-4 rounded-xl bg-[#080c14] border border-emerald-500/30 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-emerald-400 font-bold text-xs uppercase flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Deterministic Paper Execution Engine
                </h4>
                <p className="text-gray-300 text-xs mt-1 leading-relaxed">
                  All capabilities are fully active with zero real-world financial risk. Real-time market data from Binance WebSocket feeds orders directly into the SQLite event ledger.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-[11px]">
              <div className="bg-[#0f1623] p-2.5 rounded-lg border border-[#1b2537]">
                <span className="text-gray-500 text-[10px] uppercase block">Wallet State</span>
                <span className="text-emerald-400 font-bold">Simulated $10,000</span>
              </div>
              <div className="bg-[#0f1623] p-2.5 rounded-lg border border-[#1b2537]">
                <span className="text-gray-500 text-[10px] uppercase block">Order Execution</span>
                <span className="text-white font-bold">Paper Broker Active</span>
              </div>
              <div className="bg-[#0f1623] p-2.5 rounded-lg border border-[#1b2537]">
                <span className="text-gray-500 text-[10px] uppercase block">Multi-Agent AI</span>
                <span className="text-blue-400 font-bold">Full Capability</span>
              </div>
              <div className="bg-[#0f1623] p-2.5 rounded-lg border border-[#1b2537]">
                <span className="text-gray-500 text-[10px] uppercase block">Capital Risk</span>
                <span className="text-emerald-400 font-bold">0% (Zero Risk)</span>
              </div>
            </div>
          </div>
        )}

        {operatingMode === 'live' && (
          <div className={`p-4 rounded-xl bg-[#080c14] border ${liveArmed ? 'border-red-500/40' : 'border-amber-500/40'} space-y-3`}>
            <div className="flex items-start justify-between">
              <div>
                <h4 className={`font-bold text-xs uppercase flex items-center gap-1.5 ${liveArmed ? 'text-red-400' : 'text-amber-400'}`}>
                  {liveArmed ? <AlertTriangle className="w-4 h-4 animate-pulse" /> : <Lock className="w-4 h-4" />}
                  {liveArmed ? 'Real Exchange Execution Armed (CoinDCX Futures)' : 'Real Exchange Execution Disarmed (Orders Blocked)'}
                </h4>
                <p className="text-gray-300 text-xs mt-1 leading-relaxed">
                  {liveArmed
                    ? 'WARNING: Strategy and manual orders are routed directly to the CoinDCX Futures exchange endpoint using real account equity.'
                    : 'The LiveTradingGuard is actively blocking order routing to external exchanges. Arming the gate enables live order submission.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              {liveArmed ? (
                <button
                  onClick={() => setIsDisarmModalOpen(true)}
                  disabled={disarmMode.isPending}
                  className="flex items-center gap-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 px-4 py-2 rounded-xl font-bold cursor-pointer transition-all disabled:opacity-50"
                >
                  <Lock className="w-4 h-4" /> Disarm Live Execution
                </button>
              ) : (
                <button
                  onClick={() => setIsArmModalOpen(true)}
                  disabled={armMode.isPending}
                  className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded-xl cursor-pointer shadow-lg shadow-red-900/30 transition-all disabled:opacity-50"
                >
                  <Unlock className="w-4 h-4" /> Arm Real Execution Gate
                </button>
              )}
              <span className="text-gray-500 text-[11px]">
                Gate Status: <strong className={liveArmed ? 'text-red-400' : 'text-gray-400'}>{liveArmed ? 'ARMED' : 'DISARMED'}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Aggressive Fast-Paced Simulation Mode Box */}
        <div className="p-4 rounded-xl bg-[#080c14] border border-purple-500/30 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-purple-400 font-bold text-xs uppercase flex items-center gap-1.5">
                <Zap className="w-4 h-4" /> Fast Aggressive Simulation Profile
              </h4>
              <p className="text-gray-300 text-xs mt-1 leading-relaxed">
                Evaluates setups rapidly on 1-minute bars with lower confluence thresholds and tight dynamic ATR brackets (1.0x SL / 1.5x TP).
                Enables testing the complete trade lifecycle (entry, position flipping, SL/TP execution, fee deduction, and realized PnL) in real-time.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => triggerEval.mutate()}
                disabled={triggerEval.isPending}
                className="flex items-center gap-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/40 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{triggerEval.isPending ? 'Evaluating...' : 'Scan All Pairs Now'}</span>
              </button>

              <button
                onClick={() => setAggressive.mutate(!aggressiveMode)}
                disabled={setAggressive.isPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-all cursor-pointer ${
                  aggressiveMode
                    ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30'
                    : 'bg-[#0f1623] text-gray-400 hover:text-white border border-[#1b2537]'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{aggressiveMode ? 'Aggressive: ON' : 'Aggressive: OFF'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Trading Engine Operations */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white uppercase text-xs flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Autonomous Trading Engine Controls
          </h3>
          <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg ${
            engineRunning ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-800 text-gray-400'
          }`}>
            ● Engine is {engineRunning ? 'RUNNING' : 'PAUSED'}
          </span>
        </div>

        {engineControl.error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-[11px]">
            {errorMessage(engineControl.error)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => engineControl.mutate('start')}
            disabled={engineControl.isPending || engineRunning}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" /> {engineRunning ? 'Engine Running' : 'Start Strategy Engine'}
          </button>

          <button
            onClick={() => engineControl.mutate('stop')}
            disabled={engineControl.isPending || !engineRunning}
            className="flex items-center gap-2 bg-[#080c14] hover:bg-gray-800 text-gray-300 border border-[#1b2537] font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Square className="w-4 h-4" /> Pause Engine
          </button>

          {operatingMode === 'paper' && (
            <button
              onClick={() => setIsResetModalOpen(true)}
              disabled={resetAccount.isPending}
              className="flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" /> {resetAccount.isPending ? 'Resetting...' : 'Reset Paper Account'}
            </button>
          )}

          <button
            onClick={() => setIsKillSwitchModalOpen(true)}
            disabled={engineControl.isPending}
            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50 ml-auto"
          >
            <PowerOff className="w-4 h-4" /> Emergency Kill-Switch
          </button>
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
              <ProviderStatusBadge health={providerHealth?.binance} />
            </div>
            <p className="text-gray-500 text-[10px]">Primary market data stream • bookTicker &amp; markPrice</p>
            {providerHealth?.binance && (
              <p className="text-gray-600 text-[10px]">
                Latency: {providerHealth.binance.latencyMs}ms
                {providerHealth.binance.stale ? ' • STALE' : ''}
              </p>
            )}
          </div>

          <div className="bg-[#080c14] border border-[#1b2537] p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">CoinDCX Execution</span>
              <ProviderStatusBadge health={providerHealth?.coindcx} />
            </div>
            <p className="text-gray-500 text-[10px]">Execution broker adapter &amp; market data supervisor fallback</p>
            {providerHealth?.coindcx && (
              <p className="text-gray-600 text-[10px]">
                Latency: {providerHealth.coindcx.latencyMs}ms
                {providerHealth.coindcx.stale ? ' • STALE' : ''}
              </p>
            )}
          </div>

          <div className="bg-[#080c14] border border-[#1b2537] p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-blue-400" /> Ollama LLM
              </span>
              <span className="text-emerald-400 font-bold text-[10px]">● OPERATIONAL</span>
            </div>
            <p className="text-gray-500 text-[10px]">
              Dialectical multi-agent debate runtime for autonomous signal generation.
            </p>
          </div>
        </div>
      </div>

      {/* AI Multi-Account Pool & Hybrid LLM Routing */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2537] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white uppercase text-xs">AI Agent &amp; Multi-Account LLM Pool</h3>
              <p className="text-gray-400 text-[10px]">
                Hybrid routing across up to 3 Ollama Cloud accounts with automatic failover to local daemon.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-bold">
              {agentPool?.configuredAccountsCount ?? 0} CLOUD KEYS CONFIGURED
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
              LOCAL DAEMON ACTIVE
            </span>
          </div>
        </div>

        {/* Model Routing Architecture */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-[#080c14] border border-[#1b2537] p-3.5 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[10px] uppercase font-bold flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-blue-400" /> Debate &amp; Research Model
              </span>
              <span className="font-bold text-white bg-[#141d2e] px-2 py-0.5 rounded text-[10px]">
                {agentPool?.cloudModel || 'gemma4:cloud'}
              </span>
            </div>
            <p className="text-gray-500 text-[10px]">
              Multi-turn Bull vs. Bear debate and narrative reasoning evaluated across the cloud account pool.
            </p>
          </div>

          <div className="bg-[#080c14] border border-[#1b2537] p-3.5 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[10px] uppercase font-bold flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" /> Structured Extraction &amp; Fallback
              </span>
              <span className="font-bold text-white bg-[#141d2e] px-2 py-0.5 rounded text-[10px]">
                {agentPool?.localModel || 'qwen3.5:4b'}
              </span>
            </div>
            <p className="text-gray-500 text-[10px]">
              Analyst report &amp; trader parameter schema extraction (low latency, zero token cost).
            </p>
          </div>
        </div>

        {/* Endpoint Priority Matrix */}
        <div className="space-y-2">
          <h4 className="text-gray-400 text-[10px] uppercase font-bold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-purple-400" /> Endpoint Pool &amp; Failover Priority
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(agentPool?.accounts || []).map((acc) => (
              <div
                key={acc.id}
                className={`p-3 rounded-xl border ${
                  acc.configured
                    ? 'bg-[#080c14] border-blue-500/30'
                    : 'bg-[#080c14]/50 border-[#1b2537] opacity-60'
                } space-y-1.5`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-[11px] flex items-center gap-1">
                    <Key className="w-3 h-3 text-blue-400" /> {acc.name}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    acc.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-500'
                  }`}>
                    {acc.configured ? `PRIORITY ${acc.priority}` : 'EMPTY'}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 font-mono">
                  Key: <span className="text-gray-300">{acc.maskedKey}</span>
                </div>
                <div className="text-[9px] text-gray-500">
                  Target: {agentPool?.cloudBaseUrl || 'https://ollama.com'}
                </div>
              </div>
            ))}

            {/* Local Fallback Node */}
            <div className="p-3 rounded-xl border bg-[#080c14] border-emerald-500/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-[11px] flex items-center gap-1">
                  <Database className="w-3 h-3 text-emerald-400" /> Local Daemon
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                  FALLBACK (P10)
                </span>
              </div>
              <div className="text-[10px] text-gray-400 font-mono">
                Host: <span className="text-gray-300">{agentPool?.localBaseUrl || 'http://localhost:11434'}</span>
              </div>
              <div className="text-[9px] text-gray-500">
                Model: {agentPool?.localModel || 'qwen3.5:4b'} (Local)
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Guide Footer */}
        <div className="bg-[#080c14] border border-[#1b2537] p-3 rounded-xl flex items-center justify-between text-[10px] text-gray-400">
          <span>
            To configure or rotate keys, set <code className="text-blue-400">OLLAMA_API_KEY_1</code>, <code className="text-blue-400">OLLAMA_API_KEY_2</code>, <code className="text-blue-400">OLLAMA_API_KEY_3</code> in your <code className="text-amber-400">.env</code> file.
          </span>
          <span className="text-emerald-400 font-bold ml-2 shrink-0">Auto Failover Enabled</span>
        </div>
      </div>

      {/* Arm Mode Modal */}
      <ConfirmationModal
        isOpen={isArmModalOpen}
        title="Arm Live Trading Gate"
        message="WARNING: Arming live execution allows strategy and manual orders to be dispatched directly to CoinDCX with real funds. Ensure risk limits are verified."
        confirmLabel="Arm Real Execution"
        confirmVariant="danger"
        isLoading={armMode.isPending}
        error={errorMessage(armMode.error)}
        onConfirm={() => {
          armMode.mutate(undefined, {
            onSuccess: () => setIsArmModalOpen(false),
          });
        }}
        onCancel={() => {
          armMode.reset();
          setIsArmModalOpen(false);
        }}
      />

      {/* Disarm Mode Modal */}
      <ConfirmationModal
        isOpen={isDisarmModalOpen}
        title="Disarm Live Trading Gate"
        message="This will immediately block all new orders from being dispatched to external exchange endpoints."
        confirmLabel="Disarm Execution"
        confirmVariant="warning"
        isLoading={disarmMode.isPending}
        error={errorMessage(disarmMode.error)}
        onConfirm={() => {
          disarmMode.mutate(undefined, {
            onSuccess: () => setIsDisarmModalOpen(false),
          });
        }}
        onCancel={() => {
          disarmMode.reset();
          setIsDisarmModalOpen(false);
        }}
      />

      {/* Kill Switch Modal */}
      <ConfirmationModal
        isOpen={isKillSwitchModalOpen}
        title="Activate Kill Switch"
        message="This will immediately cancel all open orders across all markets and halt the trading engine."
        confirmLabel="Activate Kill Switch"
        confirmVariant="danger"
        isLoading={engineControl.isPending}
        error={errorMessage(engineControl.error)}
        onConfirm={() => {
          engineControl.mutate('kill-switch', {
            onSuccess: () => setIsKillSwitchModalOpen(false),
          });
        }}
        onCancel={() => {
          engineControl.reset();
          setIsKillSwitchModalOpen(false);
        }}
      />

      {/* Reset Paper Account Modal */}
      <ConfirmationModal
        isOpen={isResetModalOpen}
        title="Reset Paper Trading Account"
        message="This will cancel all active paper orders, close all open paper positions, and reset your simulated balance back to $10,000 USDT. Daily profit goals and circuit limits will also be cleared."
        confirmLabel="Reset Account ($10,000)"
        confirmVariant="warning"
        isLoading={resetAccount.isPending}
        error={errorMessage(resetAccount.error)}
        onConfirm={() => {
          resetAccount.mutate(10000, {
            onSuccess: () => setIsResetModalOpen(false),
          });
        }}
        onCancel={() => {
          resetAccount.reset();
          setIsResetModalOpen(false);
        }}
      />
    </div>
  );
}
