import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/Header';
import { Sidebar, type DashboardTab } from './components/Sidebar';
import { OverviewPanel } from './components/OverviewPanel';
import { CyclesPanel } from './components/CyclesPanel';
import { CycleDetailPanel } from './components/CycleDetailPanel';
import { PerformancePanel } from './components/PerformancePanel';
import { BacktestPanel } from './components/BacktestPanel';
import { LiveFeed } from './components/LiveFeed';
import { useState } from 'react';

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
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <Header />
      <div className="flex">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="flex-1 p-6 ml-64 mt-16">
          {activeTab === 'overview' && <OverviewPanel />}
          {activeTab === 'cycles' && (
            selectedCycleId ? (
              <CycleDetailPanel
                cycleId={selectedCycleId}
                onBack={() => setSelectedCycleId(null)}
              />
            ) : (
              <CyclesPanel onSelectCycle={setSelectedCycleId} />
            )
          )}
          {activeTab === 'performance' && <PerformancePanel />}
          {activeTab === 'backtest' && <BacktestPanel />}
          {activeTab === 'feed' && <LiveFeed />}
        </main>
      </div>
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
