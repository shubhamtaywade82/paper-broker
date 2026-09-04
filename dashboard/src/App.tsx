import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWebSocket } from './hooks/useWebSocket';
import { useTickers, useDashboard } from './hooks/useApi';
import { useStore, type WorkspaceTab } from './store/useStore';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { MarketsView } from './components/markets/MarketsView';
import { TradingView } from './components/trading/TradingView';
import { AgentControlCenterView } from './components/agent/AgentControlCenterView';
import { AgentActivityToasts } from './components/agent/AgentActivityToasts';
import { ResearchView } from './components/research/ResearchView';
import { ScreenerView } from './components/screener/ScreenerView';
import { RiskView } from './components/risk/RiskView';
import { ActivityView } from './components/activity/ActivityView';
import { SystemSettingsView } from './components/system/SystemSettingsView';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  useWebSocket();
  useTickers();
  useDashboard();
  const { activeTab, setActiveTab } = useStore();

  // Keyboard navigation shortcuts: 1-8 for workspace switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      const tabs: WorkspaceTab[] = [
        'dashboard',
        'markets',
        'trading',
        'agent',
        'research',
        'screener',
        'risk',
        'activity',
        'system',
      ];

      const keyNum = parseInt(e.key, 10);
      if (keyNum >= 1 && keyNum <= 8) {
        const targetTab = tabs[keyNum - 1];
        if (targetTab) {
          setActiveTab(targetTab);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab]);

  // Sync with browser back/forward and initial URL hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
      const validTabs: WorkspaceTab[] = [
        'dashboard',
        'markets',
        'trading',
        'agent',
        'research',
        'screener',
        'risk',
        'activity',
        'system',
      ];
      if (validTabs.includes(hash as WorkspaceTab) && hash !== activeTab) {
        setActiveTab(hash as WorkspaceTab);
      }
    };

    if (!window.location.hash) {
      window.location.hash = `#${activeTab}`;
    }

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeTab, setActiveTab]);

  return (
    <div className="min-h-screen bg-[#080c14] text-[#f8fafc]">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6 ml-60 mt-16 min-h-[calc(100vh-4rem)] bg-[#080c14]">
          {activeTab === 'dashboard' && <DashboardView />}
          {activeTab === 'markets' && <MarketsView />}
          {activeTab === 'trading' && <TradingView />}
          {activeTab === 'agent' && <AgentControlCenterView />}
          {activeTab === 'research' && <ResearchView />}
          {activeTab === 'screener' && <ScreenerView />}
          {activeTab === 'risk' && <RiskView />}
          {activeTab === 'activity' && <ActivityView />}
          {activeTab === 'system' && <SystemSettingsView />}
        </main>
      </div>
      <AgentActivityToasts />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
