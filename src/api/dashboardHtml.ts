export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nemesis Trading Desk</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 500: '#3b82f6', 600: '#2563eb' },
            dark: { 900: '#0b0f19', 800: '#111827', 700: '#1f2937', 600: '#374151' }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body class="bg-dark-900 text-gray-100 min-h-screen flex flex-col antialiased">
  <!-- Top Navigation Bar -->
  <header class="border-b border-dark-700 bg-dark-800/80 backdrop-blur px-6 py-3 flex items-center justify-between sticky top-0 z-50">
    <div class="flex items-center space-x-4">
      <div class="flex items-center space-x-2">
        <div class="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>
        <span class="font-bold text-lg tracking-wider text-white">NEMESIS<span class="text-blue-500 font-normal">.DESK</span></span>
      </div>
      <span id="mode-badge" class="px-2.5 py-0.5 rounded text-xs font-semibold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">SHADOW</span>
      <span id="ws-badge" class="flex items-center space-x-1 px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        <span id="ws-status-text">WS CONNECTED</span>
      </span>
    </div>

    <div class="flex items-center space-x-3">
      <button onclick="openOrderModal()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition">
        + Place Order
      </button>
      <button id="arm-btn" onclick="armLiveTrading()" class="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded text-xs font-semibold transition">
        Arm Live
      </button>
      <button onclick="triggerKillSwitch()" class="px-3 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/40 rounded text-xs font-semibold transition">
        KILL SWITCH
      </button>
    </div>
  </header>

  <!-- Metrics Header -->
  <section class="grid grid-cols-2 md:grid-cols-6 gap-4 p-6 border-b border-dark-700 bg-dark-800/40">
    <div class="bg-dark-800 border border-dark-700/80 rounded-lg p-3">
      <div class="text-gray-400 text-xs font-medium">TOTAL EQUITY</div>
      <div id="metric-equity" class="text-xl font-bold mono mt-1 text-white">$0.00</div>
    </div>
    <div class="bg-dark-800 border border-dark-700/80 rounded-lg p-3">
      <div class="text-gray-400 text-xs font-medium">WALLET BALANCE</div>
      <div id="metric-balance" class="text-xl font-bold mono mt-1 text-gray-200">$0.00</div>
    </div>
    <div class="bg-dark-800 border border-dark-700/80 rounded-lg p-3">
      <div class="text-gray-400 text-xs font-medium">UNREALIZED PNL</div>
      <div id="metric-unrealized" class="text-xl font-bold mono mt-1 text-emerald-400">+$0.00</div>
    </div>
    <div class="bg-dark-800 border border-dark-700/80 rounded-lg p-3">
      <div class="text-gray-400 text-xs font-medium">ACTIVE POSITIONS</div>
      <div id="metric-positions-count" class="text-xl font-bold mono mt-1 text-white">0</div>
    </div>
    <div class="bg-dark-800 border border-dark-700/80 rounded-lg p-3">
      <div class="text-gray-400 text-xs font-medium">DATA FEED</div>
      <div id="metric-provider" class="text-sm font-semibold mono mt-1.5 text-blue-400 flex items-center space-x-1.5">
        <span class="w-2 h-2 rounded-full bg-blue-400"></span>
        <span id="metric-provider-name">BINANCE</span>
      </div>
    </div>
    <div class="bg-dark-800 border border-dark-700/80 rounded-lg p-3">
      <div class="text-gray-400 text-xs font-medium">SYSTEM HEALTH</div>
      <div id="metric-health" class="text-sm font-semibold mono mt-1.5 text-emerald-400 flex items-center space-x-1.5">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span>100% OPERATIONAL</span>
      </div>
    </div>
  </section>

  <!-- Main Work Area -->
  <main class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
    <!-- Left Column: Chart & Positions (8 cols) -->
    <div class="lg:col-span-8 flex flex-col space-y-6">
      <!-- Lightweight Chart -->
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center space-x-3">
            <span class="font-bold text-white tracking-wide">SOL/USDT</span>
            <span class="text-xs px-2 py-0.5 rounded bg-dark-700 text-gray-300 mono">15m</span>
            <span id="chart-ltp" class="mono font-bold text-emerald-400">--</span>
          </div>
          <div class="text-xs text-gray-400 mono">Market Feed: <span id="smc-structure" class="text-blue-400 font-semibold">BINANCE FUTURES</span></div>
        </div>
        <div id="chart-container" class="w-full h-80 rounded bg-dark-900 border border-dark-700/50"></div>
      </div>

      <!-- Active Positions -->
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-sm tracking-wide uppercase text-gray-200">Open Positions</h2>
          <span id="positions-total" class="text-xs text-gray-400">0 open</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs mono">
            <thead>
              <tr class="text-gray-400 border-b border-dark-700 pb-2">
                <th class="py-2">SYMBOL</th>
                <th>SIDE</th>
                <th>SIZE</th>
                <th>ENTRY</th>
                <th>MARK</th>
                <th>LEVERAGE</th>
                <th>UNREALIZED PNL</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody id="positions-tbody" class="divide-y divide-dark-700/60">
              <tr>
                <td colspan="8" class="py-6 text-center text-gray-500">No open positions</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Open & Recent Orders -->
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-sm tracking-wide uppercase text-gray-200">Orders & Executions</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs mono">
            <thead>
              <tr class="text-gray-400 border-b border-dark-700 pb-2">
                <th class="py-2">ORDER ID</th>
                <th>SYMBOL</th>
                <th>TYPE</th>
                <th>SIDE</th>
                <th>PRICE</th>
                <th>QTY</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody id="orders-tbody" class="divide-y divide-dark-700/60">
              <tr>
                <td colspan="7" class="py-6 text-center text-gray-500">No recent orders</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Right Column: Signals, LLM Observability, Incidents (4 cols) -->
    <div class="lg:col-span-4 flex flex-col space-y-6">
      <!-- Strategy & LLM Signals Radar -->
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-sm tracking-wide uppercase text-gray-200">Setup Radar</h2>
          <span class="text-xs text-blue-400">Live Signals</span>
        </div>
        <div id="signals-list" class="space-y-2.5 max-h-64 overflow-y-auto">
          <div class="text-xs text-gray-500 text-center py-4">Listening for strategy signals...</div>
        </div>
      </div>

      <!-- Provider Matrix & Health -->
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-col">
        <h2 class="font-bold text-sm tracking-wide uppercase text-gray-200 mb-3">Provider Grid</h2>
        <div class="space-y-2 text-xs mono">
          <div class="flex items-center justify-between p-2 rounded bg-dark-900/60 border border-dark-700/40">
            <span class="flex items-center space-x-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>Binance Futures WS</span>
            </span>
            <span id="binance-lat" class="text-emerald-400 font-semibold">--</span>
          </div>
          <div class="flex items-center justify-between p-2 rounded bg-dark-900/60 border border-dark-700/40">
            <span class="flex items-center space-x-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>CoinDCX Derivatives</span>
            </span>
            <span id="coindcx-lat" class="text-emerald-400 font-semibold">--</span>
          </div>
          <div class="flex items-center justify-between p-2 rounded bg-dark-900/60 border border-dark-700/40">
            <span class="flex items-center space-x-2">
              <span class="w-2 h-2 rounded-full bg-blue-400"></span>
              <span>Ollama AI Runtime</span>
            </span>
            <span class="text-blue-400 font-semibold">Ready</span>
          </div>
        </div>
      </div>

      <!-- Live Incidents & Events Stream -->
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-4 flex flex-col flex-1">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-sm tracking-wide uppercase text-gray-200">Incident Stream</h2>
          <span class="text-xs text-gray-400">Audit Log</span>
        </div>
        <div id="incidents-list" class="space-y-2 overflow-y-auto max-h-72 mono text-xs">
          <div class="text-gray-500 text-center py-4">No critical incidents reported</div>
        </div>
      </div>
    </div>
  </main>

  <!-- Place Order Modal -->
  <div id="order-modal" class="fixed inset-0 bg-black/70 backdrop-blur-sm hidden items-center justify-center z-50 p-4">
    <div class="bg-dark-800 border border-dark-700 rounded-xl max-w-md w-full p-6 shadow-2xl">
      <h3 class="font-bold text-lg text-white mb-4">Submit Order Command</h3>
      <form id="order-form" onsubmit="handleOrderSubmit(event)" class="space-y-4 text-xs mono">
        <div>
          <label class="block text-gray-400 mb-1">SYMBOL</label>
          <input id="form-symbol" type="text" value="SOLUSDT" required class="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-gray-400 mb-1">SIDE</label>
            <select id="form-side" class="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-white">
              <option value="BUY">BUY / LONG</option>
              <option value="SELL">SELL / SHORT</option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 mb-1">TYPE</label>
            <select id="form-type" class="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-white">
              <option value="MARKET">MARKET</option>
              <option value="LIMIT">LIMIT</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-gray-400 mb-1">QUANTITY</label>
            <input id="form-qty" type="number" step="any" value="1" required class="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-white">
          </div>
          <div>
            <label class="block text-gray-400 mb-1">LEVERAGE</label>
            <input id="form-leverage" type="number" value="5" class="w-full bg-dark-900 border border-dark-700 rounded px-3 py-2 text-white">
          </div>
        </div>
        <div class="flex justify-end space-x-3 pt-4 border-t border-dark-700">
          <button type="button" onclick="closeOrderModal()" class="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded text-gray-300">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-semibold">Submit</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let chart, candleSeries;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws';
    let socket;

    async function initChart() {
      const container = document.getElementById('chart-container');
      chart = LightweightCharts.createChart(container, {
        layout: { background: { color: '#0b0f19' }, textColor: '#9ca3af' },
        grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
        timeScale: { timeVisible: true, secondsVisible: false }
      });
      const seriesOptions = {
        upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
        wickUpColor: '#10b981', wickDownColor: '#ef4444'
      };

      if (typeof chart.addCandlestickSeries === 'function') {
        candleSeries = chart.addCandlestickSeries(seriesOptions);
      } else if (typeof chart.addSeries === 'function' && window.LightweightCharts && window.LightweightCharts.CandlestickSeries) {
        candleSeries = chart.addSeries(window.LightweightCharts.CandlestickSeries, seriesOptions);
      }

      window.addEventListener('resize', () => chart.resize(container.clientWidth, container.clientHeight));
      await loadRealKlines('SOLUSDT', '15m');
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
            document.getElementById('chart-ltp').innerText = '$' + last.close.toFixed(2);
          }
        }
      } catch (err) {
        console.warn('Failed to load real klines:', err);
      }
    }

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
      document.getElementById('mode-badge').innerText = (data.mode || 'paper').toUpperCase();
      document.getElementById('metric-equity').innerText = '$' + Number(data.account?.equity || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      document.getElementById('metric-balance').innerText = '$' + Number(data.account?.walletBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      const unPnl = Number(data.account?.unrealizedPnl || 0);
      const unEl = document.getElementById('metric-unrealized');
      unEl.innerText = (unPnl >= 0 ? '+$' : '-$') + Math.abs(unPnl).toFixed(2);
      unEl.className = 'text-xl font-bold mono mt-1 ' + (unPnl >= 0 ? 'text-emerald-400' : 'text-red-400');

      document.getElementById('metric-positions-count').innerText = data.positions?.length || 0;
      document.getElementById('positions-total').innerText = (data.positions?.length || 0) + ' open';

      // Provider matrix
      if (data.health) {
        const active = data.health.activeProvider || 'BINANCE';
        const binanceLat = data.health.binance?.latencyMs ?? 0;
        const coindcxLat = data.health.coindcx?.latencyMs ?? 0;
        document.getElementById('metric-provider-name').innerText = \`\${active} (\${active === 'BINANCE' ? binanceLat : coindcxLat}ms)\`;
        const bEl = document.getElementById('binance-lat');
        const cEl = document.getElementById('coindcx-lat');
        if (bEl) bEl.innerText = \`\${binanceLat}ms\`;
        if (cEl) cEl.innerText = \`\${coindcxLat}ms\`;
      }

      // Render positions
      const tbody = document.getElementById('positions-tbody');
      if (data.positions && data.positions.length > 0) {
        tbody.innerHTML = data.positions.map(p => \`
          <tr class="hover:bg-dark-700/40">
            <td class="py-2 font-bold text-white">\${p.symbol}</td>
            <td class="\${p.positionSide === 'LONG' ? 'text-emerald-400' : 'text-red-400'} font-bold">\${p.positionSide}</td>
            <td>\${p.qty}</td>
            <td>$\${Number(p.entryPrice).toFixed(2)}</td>
            <td>$\${Number(p.markPrice || p.entryPrice).toFixed(2)}</td>
            <td>\${p.leverage}x</td>
            <td class="\${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">\${p.unrealizedPnl >= 0 ? '+' : ''}\${Number(p.unrealizedPnl).toFixed(2)}</td>
            <td><button onclick="closePosition('\${p.symbol}')" class="px-2 py-0.5 bg-red-600/30 text-red-400 hover:bg-red-600 hover:text-white rounded text-[10px]">CLOSE</button></td>
          </tr>
        \`).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-gray-500">No open positions</td></tr>';
      }

      // Render signals
      if (data.signals && data.signals.length > 0) {
        const sigList = document.getElementById('signals-list');
        sigList.innerHTML = data.signals.map(s => \`
          <div class="p-2.5 rounded bg-dark-900/60 border border-dark-700/40 flex items-center justify-between">
            <div>
              <div class="flex items-center space-x-2">
                <span class="font-bold text-white text-xs">\${s.symbol}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold \${s.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">\${s.action}</span>
                <span class="text-gray-400 text-[10px]">\${s.strategyId}</span>
              </div>
              <div class="text-gray-400 text-[10px] mt-1">Score: \${s.score ?? 80}/100 • Conf: \${s.confidence}</div>
            </div>
            <span class="text-gray-500 text-[10px]">\${new Date(s.createdAtUtc || Date.now()).toLocaleTimeString()}</span>
          </div>
        \`).join('');
      }

      // Render incidents
      if (data.incidents && data.incidents.length > 0) {
        const incList = document.getElementById('incidents-list');
        incList.innerHTML = data.incidents.map(inc => \`
          <div class="p-2 rounded bg-dark-900/60 border border-dark-700/40 flex items-start justify-between">
            <div>
              <div class="flex items-center space-x-1.5">
                <span class="px-1.5 py-0.2 rounded text-[10px] font-bold \${inc.severity === 'WARNING' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}">\${inc.severity}</span>
                <span class="text-gray-300 font-semibold">\${inc.component}</span>
              </div>
              <div class="text-gray-400 text-[11px] mt-1">\${inc.message}</div>
            </div>
            <span class="text-gray-500 text-[10px]">\${inc.incidentId}</span>
          </div>
        \`).join('');
      }
    }

    function connectWs() {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        document.getElementById('ws-status-text').innerText = 'WS CONNECTED';
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWsEvent(msg);
        } catch (e) {}
      };
      socket.onclose = () => {
        document.getElementById('ws-status-text').innerText = 'RECONNECTING...';
        setTimeout(connectWs, 3000);
      };
    }

    function handleWsEvent(msg) {
      if (msg.type === 'market.tick' && msg.payload) {
        const p = Number(msg.payload.lastPrice || msg.payload.price || 0);
        if (p > 0) {
          document.getElementById('chart-ltp').innerText = '$' + p.toFixed(2);
        }
      }
      if (msg.type === 'order.updated' || msg.type === 'position.updated' || msg.type === 'mode.changed' || msg.type === 'signal.created') {
        fetchDashboard();
      }
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
      if (confirm('Are you sure you want to ARM Live Trading Mode? Real orders will be routed to the live venue.')) {
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

    window.onload = async () => {
      await initChart();
      await fetchDashboard();
      connectWs();
      setInterval(fetchDashboard, 5000);
    };
  </script>
</body>
</html>`;
