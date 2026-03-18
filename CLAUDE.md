# Project Instructions

This is a Vite + React + TypeScript single-page application that integrates
with the Datarails Finance OS API via the MCP server.

## Tech Stack
- Vite + React 18 + TypeScript
- Single-page app (SPA) deployed to Azure Static Web Apps

## Project Structure
```
index.html
package.json
tsconfig.json
vite.config.ts
src/
  main.tsx
  App.tsx
  App.css
  api.ts          # MCP client + token manager
  vite-env.d.ts
docs/
  openapi.json    # Full OpenAPI spec — READ THIS for all available endpoints
```

## API Integration (src/api.ts)

The app calls the Datarails API via a REST proxy at
`https://mcp-poc-tom.azurewebsites.net/api/tool`.
Auth credentials (sessionid, csrftoken) are received at runtime via
`window.postMessage` from the host page that embeds this app in an iframe.

### Auth flow

1. The host page sends a `postMessage` with `{ type: 'init', payload: { sessionid, csrftoken } }`
2. `api.ts` listens for this message at module load time (before React mounts)
3. Credentials are stored and a `credentialsReady` promise resolves
4. `App.tsx` must `await credentialsReady` before calling any API

### src/api.ts — USE THIS EXACT CODE

```typescript
const MCP_BASE = 'https://mcp-poc-tom.azurewebsites.net';

let _sessionId = '';
let _csrfToken = '';

let _resolveCredentials: () => void;
export const credentialsReady = new Promise<void>((resolve) => {
  _resolveCredentials = resolve;
});

function handleMessage(event: MessageEvent) {
  const { type, payload } = event.data ?? {};
  if (type === 'init' && payload) {
    const { sessionid, csrftoken } = payload;
    if (sessionid && csrftoken) {
      _sessionId = sessionid;
      _csrfToken = csrftoken;
      _resolveCredentials();
    }
  }
}

window.addEventListener('message', handleMessage);

export async function callMcpTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const response = await fetch(MCP_BASE + '/api/tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': _sessionId,
      'X-Csrf-Token': _csrfToken,
      'X-Domain': import.meta.env.VITE_DR_DOMAIN || 'app.datarails.com',
    },
    body: JSON.stringify({ tool: toolName, args }),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}
```

### Using the API in App.tsx

In your main component, await credentials before fetching data:

```typescript
import { credentialsReady, callMcpTool } from './api';

useEffect(() => {
  async function fetchData() {
    await credentialsReady;
    const data = await callMcpTool('aggregate_table_data', { ... });
    // use data
  }
  fetchData();
}, []);
```

**CRITICAL RULES:**
- **DO NOT** use env vars for sessionid/csrftoken — they come from postMessage at runtime.
- **DO NOT** implement a TokenManager or call `/jwt/api/token/`.
- **DO NOT** use JSON-RPC format — use the simple `{tool, args}` format.
- **ALL `table_id` values MUST be strings** — e.g. `String(table.id)` or `"16528"`.
  The API rejects integer table IDs.
- **ALWAYS** `await credentialsReady` before making any API calls.

### Fetching Financial Data

The main data table is called **"Financials"**. To find it:

```typescript
const tables = await callMcpTool('list_finance_tables', {}) as Array<{id: number, name: string}>;
const financials = tables.find(t => /^financials$/i.test(t.name)) ?? tables[0];
const tableId = String(financials.id);  // MUST be string
```

To get expense categories, use `aggregate_table_data`:

```typescript
const data = await callMcpTool('aggregate_table_data', {
  table_id: tableId,  // string!
  dimensions: ['DR_ACC_L1.5'],  // NOT DR_ACC_L1 — that one errors
  metrics: [{ field: 'Amount', agg: 'SUM' }],
  filters: [
    { name: 'Scenario', values: ['Actuals'], is_excluded: false },
    { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
  ],
});
// Returns: [{ "DR_ACC_L1.5": "COGS", "Amount": 27226241 }, ...]
```

**Dimension field rules:**
- Use `DR_ACC_L1.5` for expense categories (NOT `DR_ACC_L1`)
- Use `Department L1` for departments
- Use `Reporting Date` for time periods
- If a dimension field returns a 500 error, try appending `.5` (e.g. `L1` → `L1.5`)

### Available API Tools

- `list_finance_tables()` — List all tables (returns `[{id, uuid, name, alias}]`)
- `get_table_schema(table_id)` — Column info
- `aggregate_table_data(table_id, dimensions, metrics, filters?)` — Aggregations (no row limit)
- `get_records_by_filter(table_id, filters, limit?)` — Filtered records (max 500 rows)
- `get_sample_records(table_id, n?)` — Random sample (max 20)
- `run_ai_agent(prompt)` — AI agent for complex multi-step tasks

## Design & UX

- Professional, modern look — clean typography, good spacing, rounded corners
- Use a nice color palette (blues/grays work well for finance apps)
- Smooth transitions and hover effects
- Loading spinners for async operations
- Keep it simple — single page app, no complex routing
- The app should be in a SINGLE App.tsx file (plus api.ts for API calls)

## Build Requirements

- The app MUST compile and build without errors: `npm run build`
- Fix any TypeScript errors before finishing
- Keep the code simple — avoid complex type gymnastics
- Do NOT write test files — focus on making the app work correctly

## Conventions
- Modern React (hooks, functional components)
- Include loading states and error handling for API calls
- All API calls go through the api.ts wrapper
- Always fall back to mock data if API calls fail
