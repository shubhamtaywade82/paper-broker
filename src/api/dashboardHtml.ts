export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paper-Broker v2.1.0 • Institutional Trading Desk</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            app: {
              bg: '#080c14',
              card: '#0f1623',
              cardHover: '#141d2e',
              border: '#1b2537',
              accent: '#3b82f6',
              green: '#05cd99',
              greenBg: 'rgba(5, 205, 153, 0.12)',
              red: '#ff4d4f',
              redBg: 'rgba(255, 77, 79, 0.12)',
              gold: '#f59e0b',
              muted: '#8492a6',
              text: '#f8fafc'
            }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #080c14; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: #0b101b; }
    ::-webkit-scrollbar-thumb { background: #1f293d; border-radius: 2px; }
    .depth-bar-bid { background: linear-gradient(90deg, rgba(5,205,153,0.15) 0%, rgba(5,205,153,0) 100%); }
    .depth-bar-ask { background: linear-gradient(90deg, rgba(255,77,79,0.15) 0%, rgba(255,77,79,0) 100%); }
  </style>
</head>
<body class="bg-app-bg text-app-text min-h-screen flex text-[13px] antialiased select-none overflow-x-hidden">

  <!-- LEFT SIDEBAR NAVIGATION -->
  <aside class="w-64 bg-app-card border-r border-app-border flex flex-col justify-between shrink-0 h-screen sticky top-0 z-40">
    <div>
      <!-- Brand Header -->
      <div class="h-16 flex items-center px-5 border-b border-app-border justify-between">
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black text-sm">
            ⬡
          </div>
          <div>
            <div class="font-bold text-sm tracking-wider flex items-center space-x-1.5 text-white">
              <span>PAPER-BROKER</span>
              <span class="text-[10px] text-gray-400 font-normal">v2.1.0</span>
            </div>
            <div class="text-[10px] font-semibold text-emerald-400 tracking-wider flex items-center space-x-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span id="sidebar-mode-tag">PAPER TRADING</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="p-3 space-y-1 text-xs">
        <a href="#" class="flex items-center space-x-3 px-3 py-2.5 rounded-lg bg-blue-600/15 text-blue-400 font-semibold border border-blue-500/20">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          <span>Dashboard</span>
        </a>
        <a href="#market" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
          <span>Market</span>
        </a>
        <a href="#positions" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <span>Positions</span>
        </a>
        <a href="#orders" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          <span>Orders</span>
        </a>
        <a href="#trades" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
          <span>Trades</span>
        </a>
        <a href="#signals" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <span>Signals</span>
        </a>
        <a href="#risk" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
          <span>Risk</span>
        </a>
        <a href="#analytics" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <span>Analytics</span>
        </a>
        <a href="#strategies" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/></svg>
          <span>Strategies</span>
        </a>
        <a href="#logs" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
          <span>Logs</span>
        </a>
        <a href="#alerts" class="flex items-center space-x-3 px-3 py-2 rounded-lg text-app-muted hover:text-white hover:bg-app-cardHover transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
          <span>Alerts</span>
        </a>
      </nav>
    </div>

    <!-- Paper Account Summary Box -->
    <div class="p-4 space-y-3">
      <div class="p-3.5 rounded-xl bg-app-bg border border-app-border space-y-2.5 text-xs mono">
        <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
          <span>PAPER ACCOUNT</span>
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">ACTIVE</span>
        </div>
        <div class="flex justify-between">
          <span class="text-app-muted">Equity</span>
          <span id="side-equity" class="text-white font-semibold">$10,000.00</span>
        </div>
        <div class="flex justify-between">
          <span class="text-app-muted">Available</span>
          <span id="side-available" class="text-white font-semibold">$10,000.00</span>
        </div>
        <div class="flex justify-between">
          <span class="text-app-muted">Unrealized PnL</span>
          <span id="side-unpnl" class="text-emerald-400 font-bold">+$0.00 (0.00%)</span>
        </div>
        <div class="flex justify-between">
          <span class="text-app-muted">Margin Usage</span>
          <span id="side-margin" class="text-white font-semibold">0.0%</span>
        </div>
      </div>

      <!-- User Profile Footer -->
      <div class="flex items-center justify-between p-2 rounded-lg bg-app-cardHover/50 border border-app-border/40">
        <div class="flex items-center space-x-2.5">
          <div class="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-xs">
            👤
          </div>
          <div>
            <div class="text-xs font-semibold text-white leading-none">nemesis-oss</div>
            <div class="text-[10px] text-app-muted leading-none mt-1">Paper Mode</div>
          </div>
        </div>
        <button onclick="triggerKillSwitch()" title="Emergency Kill-Switch" class="text-red-400 hover:text-red-300 p-1">
          ⏻
        </button>
      </div>
    </div>
  </aside>

  <!-- MAIN VIEWPORT -->
  <div class="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">

    <!-- TOP HEADER WITH LIVE TICKERS & STATUS -->
    <header class="h-16 bg-app-card border-b border-app-border px-6 flex items-center justify-between sticky top-0 z-30 shrink-0">
      <!-- Left: Active Ticker Carousel -->
      <div class="flex items-center space-x-3 overflow-x-auto py-2">
        <button onclick="switchActiveSymbol('BTCUSDT')" id="ticker-BTCUSDT" class="px-3 py-1.5 rounded-lg border border-app-border bg-app-bg hover:border-blue-500/50 flex items-center space-x-2 transition">
          <span class="font-bold text-xs text-gray-200">BTCUSDT</span>
          <span id="price-BTCUSDT" class="mono text-xs font-semibold text-emerald-400">$62,437.8</span>
          <span id="chg-BTCUSDT" class="mono text-[10px] text-emerald-400">+1.62%</span>
        </button>
        <button onclick="switchActiveSymbol('ETHUSDT')" id="ticker-ETHUSDT" class="px-3 py-1.5 rounded-lg border border-app-border bg-app-bg hover:border-blue-500/50 flex items-center space-x-2 transition">
          <span class="font-bold text-xs text-gray-200">ETHUSDT</span>
          <span id="price-ETHUSDT" class="mono text-xs font-semibold text-emerald-400">$2,434.5</span>
          <span id="chg-ETHUSDT" class="mono text-[10px] text-emerald-400">+2.10%</span>
        </button>
        <button onclick="switchActiveSymbol('SOLUSDT')" id="ticker-SOLUSDT" class="px-3 py-1.5 rounded-lg border border-blue-500 bg-blue-900/20 flex items-center space-x-2 transition">
          <span class="font-bold text-xs text-white">SOLUSDT</span>
          <span id="price-SOLUSDT" class="mono text-xs font-bold text-emerald-400">$142.39</span>
          <span id="chg-SOLUSDT" class="mono text-[10px] text-emerald-400">+3.34%</span>
        </button>
        <button onclick="switchActiveSymbol('BNBUSDT')" id="ticker-BNBUSDT" class="px-3 py-1.5 rounded-lg border border-app-border bg-app-bg hover:border-blue-500/50 flex items-center space-x-2 transition">
          <span class="font-bold text-xs text-gray-200">BNBUSDT</span>
          <span id="price-BNBUSDT" class="mono text-xs font-semibold text-emerald-400">$550.1</span>
          <span id="chg-BNBUSDT" class="mono text-[10px] text-emerald-400">+0.97%</span>
        </button>
      </div>

      <!-- Right: System Status & Controls -->
      <div class="flex items-center space-x-4 shrink-0">
        <div class="flex items-center space-x-2 px-3 py-1 rounded-full bg-app-bg border border-app-border text-xs">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span class="text-app-muted">Market:</span>
          <span id="top-market-status" class="font-semibold text-white">Binance (WS)</span>
        </div>

        <div class="flex items-center space-x-1.5 text-xs mono text-app-muted">
          <span>🕒</span>
          <span id="utc-clock">12:34:56 UTC</span>
        </div>

        <button onclick="openOrderModal()" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition flex items-center space-x-1.5 shadow-lg shadow-blue-600/20">
          <span>+</span>
          <span>New Order</span>
        </button>

        <button onclick="armLiveTrading()" id="arm-btn" class="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-semibold transition">
          Arm Live
        </button>
      </div>
    </header>

    <!-- CONTENT BODY -->
    <main class="p-6 space-y-6">

      <!-- 1. TOP KPI METRIC CARDS ROW (6 CARDS) -->
      <section class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <!-- Equity -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between hover:border-app-border/80 transition">
          <div class="flex items-center justify-between text-xs text-app-muted font-medium">
            <span>EQUITY</span>
            <span class="text-emerald-400 font-semibold text-[11px]">+2.33%</span>
          </div>
          <div id="kpi-equity" class="text-2xl font-bold mono mt-1 text-white">$10,000.00</div>
          <svg class="w-full h-7 mt-2 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 100 25"><path d="M0,20 Q20,15 40,18 T70,8 T100,5" /></svg>
        </div>

        <!-- Unrealized PnL -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between hover:border-app-border/80 transition">
          <div class="flex items-center justify-between text-xs text-app-muted font-medium">
            <span>UNREALIZED PNL</span>
            <span id="kpi-unpnl-pct" class="text-emerald-400 font-semibold text-[11px]">+0.00%</span>
          </div>
          <div id="kpi-unpnl" class="text-2xl font-bold mono mt-1 text-emerald-400">+$0.00</div>
          <svg class="w-full h-7 mt-2 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 100 25"><path d="M0,18 Q30,22 60,10 T100,6" /></svg>
        </div>

        <!-- Realized PnL -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between hover:border-app-border/80 transition">
          <div class="flex items-center justify-between text-xs text-app-muted font-medium">
            <span>REALIZED PNL (24H)</span>
            <span id="kpi-realized-pct" class="text-emerald-400 font-semibold text-[11px]">+0.00%</span>
          </div>
          <div id="kpi-realized" class="text-2xl font-bold mono mt-1 text-emerald-400">+$0.00</div>
          <svg class="w-full h-7 mt-2 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 100 25"><path d="M0,22 Q30,12 60,14 T100,4" /></svg>
        </div>

        <!-- Win Rate -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between hover:border-app-border/80 transition">
          <div class="flex items-center justify-between text-xs text-app-muted font-medium">
            <span>WIN RATE</span>
            <span id="kpi-winrate-record" class="text-gray-400 text-[11px]">0W / 0L</span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <div id="kpi-winrate-pct" class="text-2xl font-bold mono text-white">0.00%</div>
            <div id="kpi-winrate-circle" class="w-9 h-9 rounded-full border-2 border-emerald-400 border-t-amber-400 flex items-center justify-center text-[9px] font-bold text-emerald-400">
              0%
            </div>
          </div>
          <div class="w-full bg-dark-700 h-1.5 rounded-full mt-2 overflow-hidden">
            <div id="kpi-winrate-bar" class="bg-emerald-400 h-full w-[0%]"></div>
          </div>
        </div>

        <!-- Active Positions -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between hover:border-app-border/80 transition">
          <div class="flex items-center justify-between text-xs text-app-muted font-medium">
            <span>ACTIVE POSITIONS</span>
            <div class="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 text-xs">💼</div>
          </div>
          <div id="kpi-positions-count" class="text-2xl font-bold mono mt-1 text-white">0</div>
          <a href="#positions" class="text-blue-400 hover:text-blue-300 text-xs font-semibold mt-2">View all →</a>
        </div>

        <!-- Open Orders -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between hover:border-app-border/80 transition">
          <div class="flex items-center justify-between text-xs text-app-muted font-medium">
            <span>OPEN ORDERS</span>
            <div class="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 text-xs">📋</div>
          </div>
          <div id="kpi-orders-count" class="text-2xl font-bold mono mt-1 text-white">0</div>
          <a href="#orders" class="text-blue-400 hover:text-blue-300 text-xs font-semibold mt-2">View all →</a>
        </div>
      </section>

      <!-- 2. MIDDLE ROW: MAIN CHART + ORDER BOOK + RECENT TRADES -->
      <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <!-- Main TradingView Chart Container (7 Cols) -->
        <div class="lg:col-span-7 bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between">
          <!-- Chart Header Toolbar -->
          <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-app-border">
            <div class="flex items-center space-x-3">
              <span id="chart-symbol-label" class="font-bold text-base text-white tracking-wide">SOLUSDT PERP</span>
              <!-- Timeframe Selector -->
              <div class="flex items-center space-x-1 bg-app-bg p-0.5 rounded-lg border border-app-border text-xs mono">
                <button onclick="setTimeframe('1m')" class="px-2 py-0.5 rounded text-app-muted hover:text-white">1m</button>
                <button onclick="setTimeframe('5m')" class="px-2 py-0.5 rounded text-app-muted hover:text-white">5m</button>
                <button onclick="setTimeframe('15m')" class="px-2 py-0.5 rounded bg-blue-600 text-white font-bold">15m</button>
                <button onclick="setTimeframe('1h')" class="px-2 py-0.5 rounded text-app-muted hover:text-white">1h</button>
                <button onclick="setTimeframe('4h')" class="px-2 py-0.5 rounded text-app-muted hover:text-white">4h</button>
                <button onclick="setTimeframe('1d')" class="px-2 py-0.5 rounded text-app-muted hover:text-white">1D</button>
              </div>
            </div>

            <!-- Price & OHLC Status -->
            <div class="flex items-center space-x-3 text-xs mono">
              <span id="chart-ltp-hero" class="text-lg font-bold text-emerald-400">$142.39</span>
              <span id="chart-chg-hero" class="text-emerald-400 font-semibold">+0.52 (+0.37%)</span>
            </div>
          </div>

          <!-- Candlestick Canvas -->
          <div id="chart-container" class="w-full h-96 mt-3 rounded-lg overflow-hidden bg-app-bg border border-app-border/50"></div>

          <!-- Bottom Time Scale Filters -->
          <div class="flex items-center justify-between pt-3 mt-2 border-t border-app-border text-xs text-app-muted mono">
            <div class="flex space-x-2">
              <span class="hover:text-white cursor-pointer">1D</span>
              <span class="hover:text-white cursor-pointer">5D</span>
              <span class="text-blue-400 font-bold cursor-pointer">1M</span>
              <span class="hover:text-white cursor-pointer">6M</span>
              <span class="hover:text-white cursor-pointer">YTD</span>
              <span class="hover:text-white cursor-pointer">1Y</span>
              <span class="hover:text-white cursor-pointer">ALL</span>
            </div>
            <div>Binance Futures Market Data Engine</div>
          </div>
        </div>

        <!-- Order Book (3 Cols) -->
        <div class="lg:col-span-3 bg-app-card border border-app-border rounded-xl p-4 flex flex-col">
          <div class="flex items-center justify-between pb-3 border-b border-app-border">
            <span class="font-bold text-xs uppercase tracking-wider text-gray-200">ORDER BOOK</span>
            <span id="ob-symbol" class="text-xs text-blue-400 mono font-semibold">SOLUSDT</span>
          </div>

          <div class="grid grid-cols-3 text-[11px] text-app-muted mono pt-2 pb-1">
            <span>Price (USDT)</span>
            <span class="text-right">Size (SOL)</span>
            <span class="text-right">Total (SOL)</span>
          </div>

          <!-- Asks (Red) -->
          <div id="orderbook-asks" class="space-y-1 mono text-xs py-1">
            <div class="grid grid-cols-3 relative depth-bar-ask py-0.5"><span class="text-red-400 font-semibold">142.45</span><span class="text-right text-gray-300">231.42</span><span class="text-right text-gray-400">1,298.75</span></div>
            <div class="grid grid-cols-3 relative depth-bar-ask py-0.5"><span class="text-red-400 font-semibold">142.44</span><span class="text-right text-gray-300">124.31</span><span class="text-right text-gray-400">1,067.33</span></div>
            <div class="grid grid-cols-3 relative depth-bar-ask py-0.5"><span class="text-red-400 font-semibold">142.43</span><span class="text-right text-gray-300">321.67</span><span class="text-right text-gray-400">943.02</span></div>
            <div class="grid grid-cols-3 relative depth-bar-ask py-0.5"><span class="text-red-400 font-semibold">142.42</span><span class="text-right text-gray-300">285.90</span><span class="text-right text-gray-400">624.35</span></div>
            <div class="grid grid-cols-3 relative depth-bar-ask py-0.5"><span class="text-red-400 font-semibold">142.41</span><span class="text-right text-gray-300">136.12</span><span class="text-right text-gray-400">335.45</span></div>
          </div>

          <!-- Mid / Mark Price Spread Indicator -->
          <div class="py-2.5 my-1 border-y border-app-border flex items-center justify-between mono">
            <div class="flex items-center space-x-1.5">
              <span id="ob-mid-price" class="text-base font-bold text-emerald-400">142.39</span>
              <span class="text-xs text-emerald-400">↑</span>
            </div>
            <span class="text-xs text-app-muted">142.40 / 142.39</span>
          </div>

          <!-- Bids (Green) -->
          <div id="orderbook-bids" class="space-y-1 mono text-xs py-1">
            <div class="grid grid-cols-3 relative depth-bar-bid py-0.5"><span class="text-emerald-400 font-semibold">142.39</span><span class="text-right text-gray-300">189.45</span><span class="text-right text-gray-400">189.45</span></div>
            <div class="grid grid-cols-3 relative depth-bar-bid py-0.5"><span class="text-emerald-400 font-semibold">142.38</span><span class="text-right text-gray-300">278.34</span><span class="text-right text-gray-400">467.79</span></div>
            <div class="grid grid-cols-3 relative depth-bar-bid py-0.5"><span class="text-emerald-400 font-semibold">142.37</span><span class="text-right text-gray-300">312.11</span><span class="text-right text-gray-400">779.90</span></div>
            <div class="grid grid-cols-3 relative depth-bar-bid py-0.5"><span class="text-emerald-400 font-semibold">142.36</span><span class="text-right text-gray-300">201.25</span><span class="text-right text-gray-400">981.15</span></div>
            <div class="grid grid-cols-3 relative depth-bar-bid py-0.5"><span class="text-emerald-400 font-semibold">142.35</span><span class="text-right text-gray-300">317.26</span><span class="text-right text-gray-400">1,298.41</span></div>
          </div>
        </div>

        <!-- Recent Trades Stream (2 Cols) -->
        <div class="lg:col-span-2 bg-app-card border border-app-border rounded-xl p-4 flex flex-col">
          <div class="flex items-center justify-between pb-3 border-b border-app-border">
            <span class="font-bold text-xs uppercase tracking-wider text-gray-200">RECENT TRADES</span>
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          </div>

          <div class="grid grid-cols-3 text-[11px] text-app-muted mono pt-2 pb-1">
            <span>Price</span>
            <span class="text-right">Size</span>
            <span class="text-right">Time</span>
          </div>

          <div id="trades-stream" class="space-y-1.5 mono text-xs overflow-hidden max-h-96">
            <div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">142.39</span><span class="text-right text-gray-300">12.35</span><span class="text-right text-gray-500">12:34:55</span></div>
            <div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">142.39</span><span class="text-right text-gray-300">8.62</span><span class="text-right text-gray-500">12:34:54</span></div>
            <div class="grid grid-cols-3"><span class="text-red-400 font-semibold">142.38</span><span class="text-right text-gray-300">21.47</span><span class="text-right text-gray-500">12:34:53</span></div>
            <div class="grid grid-cols-3"><span class="text-red-400 font-semibold">142.37</span><span class="text-right text-gray-300">15.10</span><span class="text-right text-gray-500">12:34:53</span></div>
            <div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">142.39</span><span class="text-right text-gray-300">9.21</span><span class="text-right text-gray-500">12:34:52</span></div>
            <div class="grid grid-cols-3"><span class="text-red-400 font-semibold">142.38</span><span class="text-right text-gray-300">18.33</span><span class="text-right text-gray-500">12:34:52</span></div>
            <div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">142.39</span><span class="text-right text-gray-300">25.11</span><span class="text-right text-gray-500">12:34:51</span></div>
            <div class="grid grid-cols-3"><span class="text-red-400 font-semibold">142.38</span><span class="text-right text-gray-300">14.88</span><span class="text-right text-gray-500">12:34:51</span></div>
            <div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">142.37</span><span class="text-right text-gray-300">7.44</span><span class="text-right text-gray-500">12:34:50</span></div>
            <div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">142.36</span><span class="text-right text-gray-300">11.02</span><span class="text-right text-gray-500">12:34:49</span></div>
          </div>
        </div>
      </section>

      <!-- 3. LOWER-MIDDLE ROW: POSITIONS & ORDERS SPLIT TABLES -->
      <section class="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <!-- Open Positions Table (7 Cols) -->
        <div id="positions" class="lg:col-span-7 bg-app-card border border-app-border rounded-xl p-4 flex flex-col">
          <div class="flex items-center justify-between pb-3 border-b border-app-border">
            <div class="flex items-center space-x-2">
              <span class="font-bold text-xs uppercase tracking-wider text-gray-200">POSITIONS</span>
              <span id="pos-count-badge" class="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold">0</span>
            </div>
            <button onclick="closeAllPositions()" class="text-[11px] text-red-400 hover:text-red-300">Close All</button>
          </div>

          <div class="overflow-x-auto mt-2">
            <table class="w-full text-left text-xs mono">
              <thead>
                <tr class="text-app-muted border-b border-app-border pb-2">
                  <th class="py-2">Symbol</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Entry Price</th>
                  <th>Mark Price</th>
                  <th>Unrealized PnL</th>
                  <th>ROE</th>
                  <th>TP / SL</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="positions-table-body" class="divide-y divide-app-border/60">
                <tr><td colspan="9" class="py-6 text-center text-app-muted">No open positions</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Open Orders Table (5 Cols) -->
        <div id="orders" class="lg:col-span-5 bg-app-card border border-app-border rounded-xl p-4 flex flex-col">
          <div class="flex items-center justify-between pb-3 border-b border-app-border">
            <div class="flex items-center space-x-2">
              <span class="font-bold text-xs uppercase tracking-wider text-gray-200">ORDERS</span>
              <span id="order-count-badge" class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold">0</span>
            </div>
            <button onclick="cancelAllOrders()" class="text-[11px] text-red-400 hover:text-red-300">Cancel All</button>
          </div>

          <div class="overflow-x-auto mt-2">
            <table class="w-full text-left text-xs mono">
              <thead>
                <tr class="text-app-muted border-b border-app-border pb-2">
                  <th class="py-2">Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="orders-table-body" class="divide-y divide-app-border/60">
                <tr><td colspan="7" class="py-6 text-center text-app-muted">No active orders</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 4. BOTTOM ROW (5 GRID CARDS): ACCOUNT BALANCE, EQUITY CURVE, PNL, SYSTEM STATUS, ACTIVITY FEED -->
      <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">

        <!-- Card 1: Account Balance Donut -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between">
          <div class="flex items-center justify-between pb-2 border-b border-app-border">
            <span class="font-bold text-xs text-gray-200 uppercase tracking-wider">ACCOUNT BALANCE</span>
            <span class="text-app-muted text-xs">•••</span>
          </div>

          <div class="flex items-center justify-center my-3">
            <div class="relative w-28 h-28 flex items-center justify-center">
              <svg viewBox="0 0 36 36" class="w-full h-full transform -rotate-90">
                <path class="text-dark-700" stroke-width="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path id="donut-usdt" class="text-emerald-400" stroke-dasharray="100, 100" stroke-width="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path id="donut-sol" class="text-purple-400" stroke-dasharray="0, 100" stroke-dashoffset="0" stroke-width="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path id="donut-btc" class="text-amber-400" stroke-dasharray="0, 100" stroke-dashoffset="0" stroke-width="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path id="donut-eth" class="text-blue-400" stroke-dasharray="0, 100" stroke-dashoffset="0" stroke-width="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div class="absolute text-center">
                <div class="text-[10px] text-app-muted">USDT</div>
                <div id="donut-usdt-pct" class="text-xs font-bold text-white">100%</div>
              </div>
            </div>
          </div>

          <div class="space-y-1 text-[11px] mono" id="donut-legend">
            <div class="flex justify-between items-center"><span class="flex items-center space-x-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span><span class="text-gray-300">USDT (Available)</span></span><span id="donut-usdt-val" class="text-white font-semibold">100%</span></div>
          </div>
        </div>

        <!-- Card 2: Equity Curve Area Chart -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between">
          <div class="flex items-center justify-between pb-2 border-b border-app-border">
            <span class="font-bold text-xs text-gray-200 uppercase tracking-wider">EQUITY CURVE</span>
            <span id="eq-change-pct" class="text-emerald-400 text-xs font-bold mono">+0.00%</span>
          </div>

          <div class="mt-2 text-xs mono">
            <div class="text-app-muted">Total: <span id="eq-total" class="text-white font-bold">$10,000.00</span></div>
            <div id="eq-change-abs" class="text-emerald-400">24H Change: +$0.00</div>
          </div>

          <div id="eq-chart-container" class="w-full h-24 mt-2"></div>

          <div class="flex justify-between text-[10px] text-app-muted mono pt-2 border-t border-app-border">
            <span class="bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">1D</span>
            <span>7D</span>
            <span>30D</span>
            <span>90D</span>
            <span>ALL</span>
          </div>
        </div>

        <!-- Card 3: PnL Performance Histogram -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between">
          <div class="flex items-center justify-between pb-2 border-b border-app-border">
            <span class="font-bold text-xs text-gray-200 uppercase tracking-wider">PNL PERFORMANCE</span>
            <span id="pnl-total" class="text-emerald-400 text-xs font-bold mono">+$0.00</span>
          </div>

          <!-- Bar histogram representation -->
          <div id="pnl-histogram" class="h-28 flex items-end justify-between px-2 pt-3">
          </div>

          <div id="pnl-labels" class="flex justify-between text-[10px] text-app-muted mono pt-2 border-t border-app-border">
          </div>
        </div>

        <!-- Card 4: System Status Matrix -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between">
          <div class="flex items-center justify-between pb-2 border-b border-app-border">
            <span class="font-bold text-xs text-gray-200 uppercase tracking-wider">SYSTEM STATUS</span>
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          </div>

          <div class="space-y-2 text-xs mono py-1" id="system-status-list">
            <div class="flex items-center justify-between">
              <span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span><span class="text-gray-300">Binance WS</span></span>
              <span class="text-gray-400 font-semibold">Waiting...</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span><span class="text-gray-300">Binance REST</span></span>
              <span class="text-gray-400 font-semibold">Waiting...</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span><span class="text-gray-300">Strategy Engine</span></span>
              <span class="text-gray-400 font-semibold">Waiting...</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span><span class="text-gray-300">Risk Engine</span></span>
              <span class="text-gray-400 font-semibold">Waiting...</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span><span class="text-gray-300">Paper Broker</span></span>
              <span class="text-gray-400 font-semibold">Waiting...</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span><span class="text-gray-300">SQLite Database</span></span>
              <span class="text-gray-400 font-semibold">Waiting...</span>
            </div>
          </div>
        </div>

        <!-- Card 5: Activity Feed & Incidents -->
        <div class="bg-app-card border border-app-border rounded-xl p-4 flex flex-col justify-between">
          <div class="flex items-center justify-between pb-2 border-b border-app-border">
            <span class="font-bold text-xs text-gray-200 uppercase tracking-wider">ACTIVITY FEED</span>
            <span class="text-app-muted text-xs">•••</span>
          </div>

          <div id="activity-feed-list" class="space-y-2 text-xs mono overflow-y-auto max-h-36">
            <div class="text-app-muted text-[11px]">Loading...</div>
          </div>
        </div>

      </section>

    </main>
  </div>

  <!-- PLACE ORDER MODAL -->
  <div id="order-modal" class="fixed inset-0 bg-black/80 backdrop-blur-sm hidden items-center justify-center z-50 p-4">
    <div class="bg-app-card border border-app-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
      <div class="flex items-center justify-between border-b border-app-border pb-3">
        <h3 class="font-bold text-base text-white">Place New Order</h3>
        <button onclick="closeOrderModal()" class="text-gray-400 hover:text-white text-lg">✕</button>
      </div>

      <form id="order-form" onsubmit="handleOrderSubmit(event)" class="space-y-4 text-xs mono">
        <div>
          <label class="block text-app-muted mb-1 font-semibold">SYMBOL</label>
          <select id="form-symbol" class="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-white">
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="BNBUSDT">BNBUSDT</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-app-muted mb-1 font-semibold">SIDE</label>
            <select id="form-side" class="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-white">
              <option value="BUY">BUY / LONG</option>
              <option value="SELL">SELL / SHORT</option>
            </select>
          </div>
          <div>
            <label class="block text-app-muted mb-1 font-semibold">ORDER TYPE</label>
            <select id="form-type" class="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-white">
              <option value="MARKET">MARKET</option>
              <option value="LIMIT">LIMIT</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-app-muted mb-1 font-semibold">QUANTITY</label>
            <input id="form-qty" type="number" step="any" value="1" required class="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-app-muted mb-1 font-semibold">LEVERAGE</label>
            <input id="form-leverage" type="number" value="5" class="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none">
          </div>
        </div>

        <div class="flex justify-end space-x-3 pt-4 border-t border-app-border">
          <button type="button" onclick="closeOrderModal()" class="px-4 py-2 bg-app-bg hover:bg-app-cardHover border border-app-border rounded-lg text-app-muted">Cancel</button>
          <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-semibold shadow-lg shadow-blue-600/30">Submit Order</button>
        </div>
      </form>
    </div>
  </div>

  <!-- JAVASCRIPT ENGINE & WEBSOCKET BINDINGS -->
  <script>
    let chart, candleSeries, eqChart, eqAreaSeries;
    let currentSymbol = 'SOLUSDT';
    let currentInterval = '15m';
    let recentTrades = [];
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws';
    let socket;

    async function initChart() {
      const container = document.getElementById('chart-container');
      container.innerHTML = '';
      chart = LightweightCharts.createChart(container, {
        layout: { background: { color: '#080c14' }, textColor: '#8492a6' },
        grid: { vertLines: { color: '#131b2c' }, horzLines: { color: '#131b2c' } },
        timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#1b2537' },
        rightPriceScale: { borderColor: '#1b2537' }
      });
      const seriesOptions = {
        upColor: '#05cd99', downColor: '#ff4d4f', borderVisible: false,
        wickUpColor: '#05cd99', wickDownColor: '#ff4d4f'
      };
      if (typeof chart.addCandlestickSeries === 'function') {
        candleSeries = chart.addCandlestickSeries(seriesOptions);
      } else if (typeof chart.addSeries === 'function' && window.LightweightCharts && window.LightweightCharts.CandlestickSeries) {
        candleSeries = chart.addSeries(window.LightweightCharts.CandlestickSeries, seriesOptions);
      }
      window.addEventListener('resize', () => chart.resize(container.clientWidth, container.clientHeight));
      await loadRealKlines(currentSymbol, currentInterval);
    }

    function initEquityChart() {
      const container = document.getElementById('eq-chart-container');
      if (!container || !window.LightweightCharts) return;
      container.innerHTML = '';
      eqChart = LightweightCharts.createChart(container, {
        layout: { background: { color: '#0f1623' }, textColor: '#8492a6' },
        grid: { vertLines: { visible: false }, horzLines: { color: '#1b2537' } },
        timeScale: { visible: false },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
        handleScroll: false, handleScale: false,
      });
      eqAreaSeries = eqChart.addAreaSeries({
        topColor: 'rgba(5,205,153,0.3)', bottomColor: 'rgba(5,205,153,0.02)',
        lineColor: '#05cd99', lineWidth: 2,
      });
      new ResizeObserver(() => eqChart.resize(container.clientWidth, container.clientHeight)).observe(container);
    }

    async function loadRealKlines(symbol, interval) {
      try {
        const res = await fetch(\`/api/v1/klines?symbol=\${symbol}&interval=\${interval}&limit=100\`);
        const klines = await res.json();
        if (Array.isArray(klines) && klines.length > 0) {
          const chartData = klines.map(k => ({
            time: Math.floor(k.openTime / 1000),
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close)
          }));
          candleSeries.setData(chartData);
          const last = chartData[chartData.length - 1];
          if (last) {
            document.getElementById('chart-ltp-hero').innerText = '$' + last.close.toFixed(2);
            document.getElementById('ob-mid-price').innerText = last.close.toFixed(2);
          }
        }
      } catch (err) {
        console.warn('Kline fetch error:', err);
      }
    }

    function switchActiveSymbol(symbol) {
      currentSymbol = symbol;
      document.getElementById('chart-symbol-label').innerText = symbol + ' PERP';
      document.getElementById('ob-symbol').innerText = symbol;
      ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].forEach(s => {
        const btn = document.getElementById('ticker-' + s);
        if (btn) {
          btn.className = s === symbol
            ? 'px-3 py-1.5 rounded-lg border border-blue-500 bg-blue-900/20 flex items-center space-x-2 transition'
            : 'px-3 py-1.5 rounded-lg border border-app-border bg-app-bg hover:border-blue-500/50 flex items-center space-x-2 transition';
        }
      });
      recentTrades = [];
      loadRealKlines(currentSymbol, currentInterval);
    }

    function setTimeframe(tf) { currentInterval = tf; loadRealKlines(currentSymbol, currentInterval); }

    async function fetchDashboard() {
      try {
        const res = await fetch('/api/v1/dashboard');
        const data = await res.json();
        renderDashboard(data);
      } catch (err) {
        console.error('Failed to fetch dashboard:', err);
      }
    }

    function renderDashboard(data) {
      if (!data) return;
      const equity = Number(data.account?.equity || 10000);
      const balance = Number(data.account?.walletBalance || 10000);
      const unPnl = Number(data.account?.unrealizedPnl || 0);
      const unPnlPct = equity > 0 ? (unPnl / equity) * 100 : 0;
      const marginUsage = equity > 0 ? ((equity - balance) / equity) * 100 : 0;

      document.getElementById('kpi-equity').innerText = '$' + equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      document.getElementById('eq-total').innerText = '$' + equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      document.getElementById('side-equity').innerText = '$' + equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      document.getElementById('side-available').innerText = '$' + balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const unEl = document.getElementById('kpi-unpnl');
      unEl.innerText = (unPnl >= 0 ? '+$' : '-$') + Math.abs(unPnl).toFixed(2);
      unEl.className = 'text-2xl font-bold mono mt-1 ' + (unPnl >= 0 ? 'text-emerald-400' : 'text-red-400');
      document.getElementById('kpi-unpnl-pct').innerText = (unPnlPct >= 0 ? '+' : '') + unPnlPct.toFixed(2) + '%';
      document.getElementById('side-unpnl').innerText = (unPnl >= 0 ? '+$' : '-$') + Math.abs(unPnl).toFixed(2) + ' (' + unPnlPct.toFixed(2) + '%)';
      document.getElementById('side-margin').innerText = Math.max(0, marginUsage).toFixed(1) + '%';

      const posCount = data.positions?.length || 0;
      document.getElementById('kpi-positions-count').innerText = posCount;
      document.getElementById('pos-count-badge').innerText = posCount;

      const openOrdersCount = Number(data.account?.openOrdersCount || 0);
      document.getElementById('kpi-orders-count').innerText = openOrdersCount;
      document.getElementById('order-count-badge').innerText = openOrdersCount;

      const realizedPnl = Number(data.account?.totalRealizedPnl || 0);
      const dailyRealizedPnl = Number(data.account?.dailyRealizedPnl || 0);
      const realizedPct = equity > 0 ? (dailyRealizedPnl / equity) * 100 : 0;
      const rEl = document.getElementById('kpi-realized');
      rEl.innerText = (realizedPnl >= 0 ? '+$' : '-$') + Math.abs(realizedPnl).toFixed(2);
      rEl.className = 'text-2xl font-bold mono mt-1 ' + (realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400');
      const rpEl = document.getElementById('kpi-realized-pct');
      rpEl.innerText = (realizedPct >= 0 ? '+' : '') + realizedPct.toFixed(2) + '%';
      rpEl.className = 'font-semibold text-[11px] ' + (realizedPct >= 0 ? 'text-emerald-400' : 'text-red-400');

      const posBody = document.getElementById('positions-table-body');
      if (data.positions && data.positions.length > 0) {
        posBody.innerHTML = data.positions.map(p => {
          const roe = p.entryPrice > 0 ? (((p.markPrice || p.entryPrice) - p.entryPrice) / p.entryPrice) * (p.positionSide === 'LONG' ? 100 : -100) * (p.leverage || 1) : 0;
          return \`
            <tr class="hover:bg-app-cardHover/50 transition">
              <td class="py-2.5 font-bold text-white">\${p.symbol}</td>
              <td><span class="px-2 py-0.5 rounded text-[11px] font-bold \${p.positionSide === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}">\${p.positionSide}</span></td>
              <td class="font-semibold text-gray-200">\${p.qty} \${p.symbol.replace('USDT', '')}</td>
              <td class="text-gray-300">$\${Number(p.entryPrice).toFixed(2)}</td>
              <td class="text-white font-semibold">$\${Number(p.markPrice || p.entryPrice).toFixed(2)}</td>
              <td class="\${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} font-bold">\${p.unrealizedPnl >= 0 ? '+' : ''}$\${Number(p.unrealizedPnl).toFixed(2)}</td>
              <td class="\${roe >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold">\${roe >= 0 ? '+' : ''}\${roe.toFixed(2)}%</td>
              <td class="text-app-muted">—</td>
              <td><button onclick="closePosition('\${p.symbol}')" class="px-2.5 py-1 bg-red-500/15 text-red-400 hover:bg-red-500 hover:text-white rounded text-[11px] font-semibold transition">Close</button></td>
            </tr>
          \`;
        }).join('');
      } else {
        posBody.innerHTML = '<tr><td colspan="9" class="py-6 text-center text-app-muted">No open positions</td></tr>';
      }
    }

    async function fetchWinRate() {
      try {
        const res = await fetch('/api/v1/win-rate');
        const d = await res.json();
        const pct = Number(d.winRate || 0);
        document.getElementById('kpi-winrate-pct').innerText = pct.toFixed(2) + '%';
        document.getElementById('kpi-winrate-record').innerText = (d.wins||0) + 'W / ' + (d.losses||0) + 'L';
        document.getElementById('kpi-winrate-circle').innerText = Math.round(pct) + '%';
        document.getElementById('kpi-winrate-bar').style.width = pct + '%';
      } catch (e) {}
    }

    async function fetchSystemStatus() {
      try {
        const res = await fetch('/api/v1/health/providers');
        const data = await res.json();
        const el = document.getElementById('system-status-list');
        if (!el) return;
        const b = data.binance || {};
        const st = b.status || 'DISCONNECTED';
        const lat = b.latencyMs || 0;
        const ok = s => s === 'HEALTHY';
        const deg = s => s === 'HEALTHY' || s === 'DEGRADED';
        const clr = s => ok(s) ? 'bg-emerald-400' : deg(s) ? 'bg-amber-400' : 'bg-red-400';
        const txt = s => ok(s) ? 'Connected' : deg(s) ? 'Degraded' : 'Disconnected';
        const latStr = ms => ms > 0 ? ' (' + ms + 'ms)' : '';
        const items = [
          ['Binance WS', st], ['Binance REST', st],
          ['Strategy Engine', 'HEALTHY'], ['Risk Engine', 'HEALTHY'],
          ['Paper Broker', 'HEALTHY'], ['SQLite Database', 'HEALTHY']
        ];
        el.innerHTML = items.map(function(pair) {
          var name = pair[0], status = pair[1];
          return '<div class="flex items-center justify-between"><span class="flex items-center space-x-1.5"><span class="w-1.5 h-1.5 rounded-full ' + clr(status) + '"></span><span class="text-gray-300">' + name + '</span></span><span class="' + (ok(status)||deg(status)?'text-emerald-400':'text-amber-400') + ' font-semibold">' + txt(status) + (name.startsWith('Binance')?latStr(lat):'') + '</span></div>';
        }).join('');
      } catch (e) {}
    }

    async function fetchActivityFeed() {
      try {
        const res = await fetch('/api/v1/activity?limit=15');
        const events = await res.json();
        const el = document.getElementById('activity-feed-list');
        if (!el || !Array.isArray(events) || events.length === 0) {
          if (el) el.innerHTML = '<div class="text-app-muted text-[11px]">No recent activity</div>';
          return;
        }
        el.innerHTML = events.map(function(ev) {
          const ts = new Date(ev.ts).toUTCString().slice(17, 25);
          const p = ev.payload || {};
          const type = ev.type || '';
          let desc = '';
          if (type.includes('ORDER')) {
            const sc = p.side === 'BUY' ? 'text-emerald-400' : 'text-red-400';
            desc = '<span class="font-bold text-white">' + (p.symbol||'') + '</span> <span class="' + sc + '">' + (p.side||'') + (p.quantity ? ' ' + p.quantity : '') + '</span> ' + (p.status || type.split('_').pop()) + (p.price ? ' @ ' + Number(p.price).toFixed(2) : '');
          } else if (type.includes('POSITION')) {
            const sc = (p.positionSide || p.side) === 'LONG' ? 'text-emerald-400' : 'text-red-400';
            desc = '<span class="font-bold text-white">' + (p.symbol||'') + '</span> <span class="' + sc + '">' + (p.positionSide || p.side || '') + '</span> ' + type.split('_').pop();
          } else if (type.includes('FILL')) {
            const sc = p.side === 'BUY' ? 'text-emerald-400' : 'text-red-400';
            desc = '<span class="font-bold text-white">' + (p.symbol||'') + '</span> <span class="' + sc + '">' + (p.side||'') + '</span> filled' + (p.price ? ' @ ' + Number(p.price).toFixed(2) : '');
          } else if (type.includes('SYSTEM') || type.includes('SIGNAL')) {
            desc = '<span class="text-gray-400">System:</span> ' + (p.eventType || p.action || type);
          } else {
            desc = '<span class="text-gray-400">' + type + '</span>';
          }
          return '<div class="flex items-start space-x-2"><span class="text-app-muted text-[10px]">' + ts + '</span><div>' + desc + '</div></div>';
        }).join('');
      } catch (e) {}
    }

    async function fetchEquityCurve() {
      try {
        const res = await fetch('/api/v1/equity-curve?limit=100');
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;
        const first = data[0], last = data[data.length - 1];
        const change = last.equity - first.equity;
        const changePct = first.equity > 0 ? (change / first.equity) * 100 : 0;
        const pctEl = document.getElementById('eq-change-pct');
        const absEl = document.getElementById('eq-change-abs');
        if (pctEl) {
          pctEl.innerText = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
          pctEl.className = (changePct >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-xs font-bold mono';
        }
        if (absEl) {
          absEl.innerText = '24H Change: ' + (change >= 0 ? '+$' : '-$') + Math.abs(change).toFixed(2);
          absEl.className = changePct >= 0 ? 'text-emerald-400' : 'text-red-400';
        }
        if (eqAreaSeries) {
          eqAreaSeries.setData(data.map(d => ({ time: Math.floor(new Date(d.ts).getTime() / 1000), value: d.equity })));
        }
      } catch (e) {}
    }

    async function fetchPnlHistory() {
      try {
        const res = await fetch('/api/v1/equity-curve?limit=30');
        const data = await res.json();
        if (!Array.isArray(data) || data.length < 2) return;
        const dailyPnl = [];
        for (let i = 1; i < data.length; i++) {
          const day = new Date(data[i].ts).toLocaleDateString('en-US', { day: 'numeric' });
          dailyPnl.push({ day: day, pnl: data[i].totalRealizedPnl - data[i - 1].totalRealizedPnl });
        }
        const maxAbs = Math.max(...dailyPnl.map(d => Math.abs(d.pnl)), 1);
        const totalPnl = data[data.length - 1].totalRealizedPnl;
        const tpEl = document.getElementById('pnl-total');
        if (tpEl) {
          tpEl.innerText = (totalPnl >= 0 ? '+$' : '-$') + Math.abs(totalPnl).toFixed(2);
          tpEl.className = (totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400') + ' text-xs font-bold mono';
        }
        const histEl = document.getElementById('pnl-histogram');
        const labelsEl = document.getElementById('pnl-labels');
        if (!histEl || !labelsEl) return;
        histEl.innerHTML = dailyPnl.map(d => {
          const h = Math.max(4, Math.round((Math.abs(d.pnl) / maxAbs) * 100));
          return '<div class="w-2.5 ' + (d.pnl >= 0 ? 'bg-emerald-400' : 'bg-red-400') + ' rounded-t" style="height:' + h + 'px" title="' + d.day + ': ' + (d.pnl >= 0 ? '+' : '') + d.pnl.toFixed(2) + '"></div>';
        }).join('');
        labelsEl.innerHTML = dailyPnl.map(d => '<span>' + d.day + '</span>').join('');
      } catch (e) {}
    }

    function connectWs() {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        document.getElementById('top-market-status').innerText = 'Binance (WS) Connected';
      };
      socket.onmessage = (event) => {
        try {
          handleWsEvent(JSON.parse(event.data));
        } catch (e) {}
      };
      socket.onclose = () => {
        document.getElementById('top-market-status').innerText = 'Reconnecting...';
        setTimeout(connectWs, 3000);
      };
    }

    function handleWsEvent(msg) {
      if (msg.type === 'market.tick' && msg.payload) {
        const p = Number(msg.payload.lastPrice || msg.payload.price || 0);
        if (p > 0 && msg.payload.symbol === currentSymbol) {
          document.getElementById('chart-ltp-hero').innerText = '$' + p.toFixed(2);
          document.getElementById('ob-mid-price').innerText = p.toFixed(2);
        }
        if (msg.payload.symbol) {
          const tp = document.getElementById('price-' + msg.payload.symbol);
          if (tp && p > 0) tp.innerText = '$' + p.toFixed(p > 500 ? 1 : 2);
        }
      }

      if (msg.type === 'trade.stream' && msg.payload) {
        const t = msg.payload;
        if (t.symbol === currentSymbol) {
          const time = new Date(t.ts).toUTCString().slice(17, 25);
          recentTrades.unshift({ price: t.price, qty: t.qty, time: time });
          if (recentTrades.length > 15) recentTrades.pop();
          const el = document.getElementById('trades-stream');
          if (el) {
            el.innerHTML = recentTrades.map(tr =>
              '<div class="grid grid-cols-3"><span class="text-emerald-400 font-semibold">' + Number(tr.price).toFixed(2) + '</span><span class="text-right text-gray-300">' + Number(tr.qty).toFixed(2) + '</span><span class="text-right text-gray-500">' + tr.time + '</span></div>'
            ).join('');
          }
        }
      }

      if (msg.type === 'book.update' && msg.payload) {
        const b = msg.payload;
        if (b.symbol === currentSymbol) {
          const bid = Number(b.bid), ask = Number(b.ask);
          const mid = (bid + ask) / 2, spread = ask - bid;
          const mEl = document.getElementById('ob-mid-price');
          if (mEl) mEl.innerText = mid.toFixed(2);

          const asks = [];
          for (let i = 5; i >= 1; i--) {
            const p = (ask + spread * i).toFixed(2);
            const sz = (Number(b.askQty || 1) * (6 - i) * 0.3).toFixed(2);
            asks.push('<div class="grid grid-cols-3 relative depth-bar-ask py-0.5"><span class="text-red-400 font-semibold">' + p + '</span><span class="text-right text-gray-300">' + sz + '</span><span class="text-right text-gray-400">' + (Number(sz) * (6 - i)).toFixed(2) + '</span></div>');
          }
          const aEl = document.getElementById('orderbook-asks');
          if (aEl) aEl.innerHTML = asks.join('');

          const bids = [];
          for (let i = 1; i <= 5; i++) {
            const p = (bid - spread * (i - 1)).toFixed(2);
            const sz = (Number(b.bidQty || 1) * i * 0.3).toFixed(2);
            bids.push('<div class="grid grid-cols-3 relative depth-bar-bid py-0.5"><span class="text-emerald-400 font-semibold">' + p + '</span><span class="text-right text-gray-300">' + sz + '</span><span class="text-right text-gray-400">' + (Number(sz) * i).toFixed(2) + '</span></div>');
          }
          const bEl = document.getElementById('orderbook-bids');
          if (bEl) bEl.innerHTML = bids.join('');
        }
      }

      if (msg.type === 'order.updated' || msg.type === 'position.updated' || msg.type === 'mode.changed') {
        fetchDashboard();
      }
    }

    function updateClock() {
      const now = new Date();
      document.getElementById('utc-clock').innerText = now.toUTCString().slice(17, 25) + ' UTC';
    }

    function openOrderModal() { document.getElementById('order-modal').classList.remove('hidden'); document.getElementById('order-modal').classList.add('flex'); }
    function closeOrderModal() { document.getElementById('order-modal').classList.add('hidden'); document.getElementById('order-modal').classList.remove('flex'); }

    async function handleOrderSubmit(e) {
      e.preventDefault();
      const payload = {
        symbol: document.getElementById('form-symbol').value,
        side: document.getElementById('form-side').value,
        type: document.getElementById('form-type').value,
        quantity: parseFloat(document.getElementById('form-qty').value),
        leverage: parseInt(document.getElementById('form-leverage').value) || 5
      };
      try {
        const res = await fetch('/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          closeOrderModal();
          fetchDashboard();
        } else {
          const err = await res.json();
          alert('Order rejected: ' + JSON.stringify(err));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      }
    }

    async function armLiveTrading() {
      if (confirm('ARM LIVE TRADING: Real orders will route to the live exchange. Are you sure?')) {
        await fetch('/api/v1/mode/arm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        fetchDashboard();
      }
    }

    async function triggerKillSwitch() {
      if (confirm('EMERGENCY: Cancel all orders and stop engine?')) {
        await fetch('/engine/kill-switch', { method: 'POST' });
        fetchDashboard();
      }
    }

    async function fetchLiveTickers() {
      try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const tickers = await res.json();
        if (Array.isArray(tickers)) {
          ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].forEach(sym => {
            const item = tickers.find(t => t.symbol === sym);
            if (item) {
              const p = parseFloat(item.lastPrice);
              const chg = parseFloat(item.priceChangePercent);
              const pEl = document.getElementById('price-' + sym);
              const cEl = document.getElementById('chg-' + sym);
              if (pEl) pEl.innerText = '$' + p.toLocaleString(undefined, { minimumFractionDigits: p > 500 ? 1 : 2, maximumFractionDigits: p > 500 ? 1 : 2 });
              if (cEl) {
                cEl.innerText = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                cEl.className = 'mono text-[10px] ' + (chg >= 0 ? 'text-emerald-400' : 'text-red-400');
              }
              if (sym === currentSymbol) {
                const heroP = document.getElementById('chart-ltp-hero');
                const heroC = document.getElementById('chart-chg-hero');
                if (heroP) heroP.innerText = '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (heroC) {
                  heroC.innerText = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                  heroC.className = 'font-semibold ' + (chg >= 0 ? 'text-emerald-400' : 'text-red-400');
                }
              }
            }
          });
        }
      } catch (e) {
        console.warn('Live ticker fetch error:', e);
      }
    }

    window.onload = async () => {
      await initChart();
      initEquityChart();
      await fetchDashboard();
      await fetchLiveTickers();
      fetchWinRate();
      fetchSystemStatus();
      fetchActivityFeed();
      fetchEquityCurve();
      fetchPnlHistory();
      connectWs();
      setInterval(updateClock, 1000);
      setInterval(fetchDashboard, 5000);
      setInterval(fetchLiveTickers, 3000);
      setInterval(fetchWinRate, 10000);
      setInterval(fetchSystemStatus, 5000);
      setInterval(fetchActivityFeed, 5000);
      setInterval(fetchEquityCurve, 15000);
      setInterval(fetchPnlHistory, 15000);
    };
  </script>
</body>
</html>`;
