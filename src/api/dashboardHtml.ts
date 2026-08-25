export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Paper-Broker • Trading Desk</title>
  <style>
    body { background-color: #080c14; color: #e2e8f0; font-family: ui-monospace, monospace; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background-color: #0f1623; border: 1px solid #1b2537; padding: 2.5rem; border-radius: 1rem; max-width: 480px; text-align: center; }
    h1 { color: #60a5fa; font-size: 1.25rem; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; margin-bottom: 1.5rem; }
    code { background: #1b2537; color: #38bdf8; padding: 0.25rem 0.5rem; border-radius: 0.375rem; font-size: 0.85rem; }
    a { display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: bold; }
    a:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Paper-Broker Trading Desk</h1>
    <p>The modern React dashboard build was not found in <code>dashboard/dist</code>.</p>
    <p>Please run <code>pnpm --filter dashboard build</code> to generate the client assets.</p>
    <a href="/api/v1/dashboard">View API Status JSON</a>
  </div>
</body>
</html>
`;
