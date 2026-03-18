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
