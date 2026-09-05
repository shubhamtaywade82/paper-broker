import { useState } from 'react';
import { useStore, type LiveEventItem } from '../../store/useStore';
import { useActivity, useCycles } from '../../hooks/useApi';
import {
  Search,
  Code,
  X,
  Zap,
  GitBranch,
  Shield,
  ArrowUpDown,
  TrendingUp,
  BookOpen,
} from 'lucide-react';

function formatEventSummary(evt: LiveEventItem): string {
  const p = evt.payload;
  if (!p || Object.keys(p).length === 0) return 'No payload';

  if (evt.type === 'agent.cycle' || evt.type === 'cycle') {
    return `[${p.symbol || 'MARKET'}] ${p.action || 'NEUTRAL'} • ${p.rationale || 'Autonomous cycle completed'}`;
  }
  if (evt.type === 'agent_step') {
    return `[${p.symbol || 'MARKET'}] ${p.stage || 'step'} (${p.status}): ${p.detail || ''}`;
  }
  if (evt.type === 'position' || evt.type === 'position.updated') {
    return `${p.symbol} ${p.side} qty=${p.quantity} entry=${p.entryPrice} mark=${p.markPrice}`;
  }
  if (evt.type === 'order' || evt.type === 'order.updated' || evt.type === 'order.filled') {
    return `${p.symbol} ${p.side} ${p.type} qty=${p.quantity} price=${p.price || 'MKT'} status=${p.status || 'OPEN'}`;
  }
  if (evt.type === 'trade') {
    return `${p.symbol} price=${p.price} qty=${p.qty}`;
  }
  if (evt.type === 'risk' || evt.type === 'risk.alert') {
    return `${p.symbol || 'GLOBAL'} ${p.rule || 'ALERT'}: ${p.message || p.action || ''}`;
  }
  if (evt.type === 'SCREENER_STEP') {
    return `[SCREENER] ${p.message || ''}`;
  }
  if (evt.type === 'SCREENER_RESULT') {
    return `[SCREENER] Scan complete: ${p.totalPassed}/${p.totalScreened} passed. Top: ${(p.topPicks as string[] | undefined)?.join(', ') || 'none'}`;
  }
  return JSON.stringify(p);
}

function classifyStream(type: string, explicitStream?: string): string {
  if (explicitStream && ['market', 'agent', 'trading', 'risk', 'system'].includes(explicitStream)) {
    return explicitStream;
  }
  const t = type.toLowerCase();
  if (t.includes('agent') || t.includes('cycle') || t.includes('signal') || t.includes('debate') || t.includes('analyst') || t.includes('screener')) {
    return 'agent';
  }
  if (t.includes('order') || t.includes('position') || t.includes('fill') || t.includes('trade_intent')) {
    return 'trading';
  }
  if (t.includes('market') || t.includes('tick') || t.includes('book') || t.includes('kline') || t.includes('trade')) {
    return 'market';
  }
  if (t.includes('risk') || t.includes('incident') || t.includes('guard') || t.includes('divergence')) {
    return 'risk';
  }
  return 'system';
}

export function ActivityView() {
  const { liveEvents, cycles: storeCycles } = useStore();
  const { data: fetchedCycles = [] } = useCycles();
  const { data: dbEvents = [] } = useActivity(100);

  const cycles = fetchedCycles.length > 0 ? fetchedCycles : storeCycles;

  const [selectedStream, setSelectedStream] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<LiveEventItem | null>(null);

  // Combine live WebSocket events, agent cycles, and fetched DB events
  const cycleEvents: LiveEventItem[] = cycles.map((c) => ({
    id: `cycle_${c.cycleId}`,
    type: 'agent.cycle',
    stream: 'agent',
    payload: {
      cycleId: c.cycleId,
      symbol: c.symbol,
      action: c.action,
      confidence: c.confidence,
      verdict: c.verdict,
      rationale: c.rationale,
      executed: c.executed,
    },
    timestamp: c.startedAt,
  }));

  const rawDbEvents: LiveEventItem[] = dbEvents.map((e) => ({
    id: e.id,
    type: e.type,
    stream: classifyStream(e.type),
    payload: e.payload || {},
    timestamp: new Date(e.ts).getTime(),
  }));

  // Deduplicate and classify streams
  const seenIds = new Set<string>();
  const allEvents: LiveEventItem[] = [];

  for (const item of [...liveEvents, ...cycleEvents, ...rawDbEvents]) {
    const key = item.id || `${item.type}_${item.timestamp}`;
    if (!seenIds.has(key)) {
      seenIds.add(key);
      allEvents.push({
        ...item,
        stream: classifyStream(item.type, item.stream),
      });
    }
  }

  // Sort descending by timestamp
  allEvents.sort((a, b) => b.timestamp - a.timestamp);

  const filteredEvents = allEvents.filter((e) => {
    if (selectedStream !== 'all' && e.stream !== selectedStream) {
      return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchType = e.type.toLowerCase().includes(q);
      const matchPayload = JSON.stringify(e.payload).toLowerCase().includes(q);
      return matchType || matchPayload;
    }
    return true;
  });

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'cycle':
      case 'agent.cycle':
        return <GitBranch className="w-4 h-4 text-blue-400" />;
      case 'position':
      case 'position.updated':
        return <ArrowUpDown className="w-4 h-4 text-amber-400" />;
      case 'risk':
      case 'risk.alert':
        return <Shield className="w-4 h-4 text-red-400" />;
      case 'trade':
      case 'trade.stream':
        return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'book':
      case 'book.update':
        return <BookOpen className="w-4 h-4 text-purple-400" />;
      default:
        return <Zap className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-5 font-mono text-xs select-none">
      {/* Activity Filter Header */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Stream Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {['all', 'market', 'agent', 'trading', 'risk', 'system'].map((stream) => (
            <button
              key={stream}
              onClick={() => setSelectedStream(stream)}
              className={`px-3 py-1.5 rounded-lg uppercase font-bold text-[11px] transition-all cursor-pointer ${
                selectedStream === stream
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                  : 'bg-[#080c14] text-gray-400 hover:text-white border border-[#1b2537]'
              }`}
            >
              {stream}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search payload or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#080c14] border border-[#1b2537] rounded-lg pl-8 pr-3 py-1.5 text-white placeholder-gray-500 text-xs w-64"
          />
        </div>
      </div>

      {/* Events Stream List */}
      <div className="bg-[#0f1623] border border-[#1b2537] rounded-xl overflow-hidden">
        {filteredEvents.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            No events matched the selected stream and search filters.
          </div>
        ) : (
          <div className="divide-y divide-[#1b2537] max-h-[600px] overflow-y-auto">
            {filteredEvents.map((evt, idx) => (
              <div
                key={evt.id || idx}
                onClick={() => setSelectedEvent(evt)}
                className="p-4 hover:bg-[#141d2e] transition flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-2 rounded-lg bg-[#080c14] border border-[#1b2537]">
                    {getEventIcon(evt.type)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white uppercase text-[11px]">{evt.type}</span>
                      <span className="px-1.5 py-0.2 rounded bg-gray-800 text-gray-400 text-[9px] uppercase font-bold">
                        {evt.stream || 'system'}
                      </span>
                    </div>
                    <p className="text-gray-400 text-[11px] mt-0.5 line-clamp-1">
                      {formatEventSummary(evt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right">
                  <span className="text-gray-500 text-[10px]">
                    {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <Code className="w-4 h-4 text-gray-500 hover:text-blue-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Raw Event Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="bg-[#111827] border border-[#2d3a4f] rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#2d3a4f] pb-3">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white uppercase">
                  Event Forensic Payload • {selectedEvent.type}
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#080c14] rounded-xl p-4 border border-[#1b2537] overflow-y-auto flex-1 text-[11px] text-gray-300">
              <pre className="whitespace-pre-wrap font-mono">
                {JSON.stringify(selectedEvent, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedEvent(null)}
                className="bg-[#1f2937] hover:bg-gray-700 text-white font-bold px-4 py-2 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
