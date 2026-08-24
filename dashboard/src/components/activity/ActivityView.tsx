import { useState } from 'react';
import { useStore, type LiveEventItem } from '../../store/useStore';
import { useActivity } from '../../hooks/useApi';
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

export function ActivityView() {
  const { liveEvents } = useStore();
  const { data: dbEvents = [] } = useActivity(50);

  const [selectedStream, setSelectedStream] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<LiveEventItem | null>(null);

  // Combine live WebSocket events and fetched DB events
  const allEvents: LiveEventItem[] = [
    ...liveEvents,
    ...dbEvents.map((e) => ({
      id: e.id,
      type: e.type,
      stream: e.type.split('.')[0] || 'system',
      payload: e.payload || {},
      timestamp: new Date(e.ts).getTime(),
    })),
  ];

  const filteredEvents = allEvents.filter((e) => {
    if (selectedStream !== 'all' && e.stream !== selectedStream && e.type !== selectedStream) {
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
                      {JSON.stringify(evt.payload)}
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
