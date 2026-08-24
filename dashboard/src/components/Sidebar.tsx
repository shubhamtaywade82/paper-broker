import {
  LayoutDashboard,
  CandlestickChart,
  ArrowLeftRight,
  Bot,
  FlaskConical,
  ShieldAlert,
  Radio,
  Settings,
} from 'lucide-react';
import { useStore, type WorkspaceTab } from '../store/useStore';

interface NavItem {
  id: WorkspaceTab;
  label: string;
  badge?: string;
  icon: typeof LayoutDashboard;
}

const mainNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'markets', label: 'Markets', icon: CandlestickChart },
  { id: 'trading', label: 'Trading', icon: ArrowLeftRight },
  { id: 'agent', label: 'Agent', badge: 'AI', icon: Bot },
  { id: 'research', label: 'Research', icon: FlaskConical },
  { id: 'risk', label: 'Risk Engine', icon: ShieldAlert },
];

const systemNavItems: NavItem[] = [
  { id: 'activity', label: 'Activity', icon: Radio },
  { id: 'system', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { activeTab, setActiveTab, operatingMode, wsConnected, positions } = useStore();

  return (
    <aside className="fixed left-0 top-16 bottom-0 w-60 bg-[#0f1623] border-r border-[#1b2537] p-3 flex flex-col justify-between select-none z-30 font-mono text-xs">
      <div className="space-y-6">
        {/* Main Workspaces */}
        <div>
          <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            Workspace
          </p>
          <nav className="space-y-1">
            {mainNavItems.map(({ id, label, badge, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl font-medium transition-all cursor-pointer ${
                  activeTab === id
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                    : 'text-gray-400 hover:bg-[#141d2e] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </div>
                {badge && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    {badge}
                  </span>
                )}
                {id === 'trading' && positions.length > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400">
                    {positions.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* System & Logs */}
        <div>
          <p className="px-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            System
          </p>
          <nav className="space-y-1">
            {systemNavItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-medium transition-all cursor-pointer ${
                  activeTab === id
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                    : 'text-gray-400 hover:bg-[#141d2e] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Autonomous System Status Box */}
      <div className="bg-[#080c14] rounded-xl p-3.5 border border-[#1b2537] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Engine Status</span>
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            ONLINE
          </span>
        </div>
        <div className="space-y-1 text-[11px] text-gray-400">
          <div className="flex justify-between">
            <span>Mode</span>
            <span className="text-white uppercase font-bold">{operatingMode}</span>
          </div>
          <div className="flex justify-between">
            <span>WebSocket</span>
            <span className={wsConnected ? 'text-emerald-400' : 'text-red-400'}>
              {wsConnected ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Active Positions</span>
            <span className="text-white font-bold">{positions.length}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
