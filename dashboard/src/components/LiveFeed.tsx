import { useStore } from '../store/useStore';
import { format } from 'date-fns';
import { Zap, AlertTriangle, Bot, ArrowUpDown, TrendingUp, ShieldCheck } from 'lucide-react';

export function LiveFeed() {
  const { liveEvents } = useStore();

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'cycle': return <Bot className="w-4 h-4 text-purple-400" />;
      case 'agent_step': return <Bot className="w-4 h-4 text-blue-400" />;
      case 'position': return <ArrowUpDown className="w-4 h-4 text-amber-400" />;
      case 'risk': return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'order': return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'system': return <ShieldCheck className="w-4 h-4 text-gray-400" />;
      default: return <Zap className="w-4 h-4 text-gray-400" />;
    }
  };

  const getEventMessage = (event: { type: string; payload: Record<string, unknown> }) => {
    switch (event.type) {
      case 'cycle':
        return `Agent Cycle: ${event.payload.symbol || ''} ${event.payload.action || ''} • ${event.payload.reasoning || event.payload.summary || ''}`;
      case 'agent_step':
        return `Agent Step: ${event.payload.symbol || ''} [${event.payload.stage || ''}] • ${event.payload.detail || ''}`;
      case 'position':
        return `Position Updated: ${event.payload.symbol || ''} ${event.payload.positionSide || ''}`;
      case 'order':
        return `Order: ${event.payload.symbol || ''} ${event.payload.side || ''} ${event.payload.type || ''} - ${event.payload.status || ''}`;
      case 'risk':
        return `Risk Alert: ${event.payload.message || 'Risk gate triggered'}`;
      case 'system':
        return `System Event: ${JSON.stringify(event.payload)}`;
      default:
        return JSON.stringify(event.payload).slice(0, 120);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <div>
        <h2 className="text-lg font-bold text-white uppercase tracking-wide">Agent Flow Event Stream</h2>
        <p className="text-xs text-gray-400">Real-time agentic reasoning, decision cycles, and order execution logs</p>
      </div>

      {liveEvents.length === 0 ? (
        <div className="bg-[#1a2332] rounded-xl border border-[#2d3a4f] p-12 text-center">
          <Bot className="w-8 h-8 text-purple-400 mx-auto mb-3" />
          <p className="text-xs text-gray-400">
            Listening for live WebSocket events... Trigger an agent cycle or place an order to see updates.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {liveEvents.map((event, i) => (
            <div
              key={i}
              className="bg-[#1a2332] border border-[#2d3a4f] rounded-lg p-4 flex items-start gap-3 text-xs"
            >
              <div className="mt-0.5">{getEventIcon(event.type)}</div>
              <div className="flex-1">
                <p className="text-gray-200">
                  {getEventMessage(event)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {format(event.timestamp, 'HH:mm:ss')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
