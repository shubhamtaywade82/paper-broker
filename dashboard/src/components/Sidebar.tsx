import { LayoutDashboard, GitBranch, TrendingUp, Radio } from 'lucide-react';

export type DashboardTab = 'overview' | 'cycles' | 'performance' | 'feed';

interface SidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const navItems: Array<{ id: DashboardTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'cycles', label: 'Agent Cycles', icon: GitBranch },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'feed', label: 'Live Feed', icon: Radio },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-[#111827] border-r border-[#2d3a4f] p-4 flex flex-col justify-between">
      <nav className="space-y-1.5">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:bg-[#243044] hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="bg-[#1a2332] rounded-xl p-4 border border-[#2d3a4f]">
        <p className="text-xs text-gray-400 mb-2 font-mono uppercase tracking-wider">System Status</p>
        <div className="space-y-2 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-gray-400">Ollama SDK</span>
            <span className="text-emerald-400">● Online</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Binance WS</span>
            <span className="text-emerald-400">● Streaming</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Trading Engine</span>
            <span className="text-emerald-400">● Armed</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
