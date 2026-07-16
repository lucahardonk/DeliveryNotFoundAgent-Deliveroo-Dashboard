/**
 * HTTP client used by agents to push their state to the dashboard server.
 *
 * WHY THIS EXISTS:
 * Each `node src/main.js` invocation is a SEPARATE OS process with its own
 * memory. The in-memory {@link DashboardBridge} singleton therefore only sees
 * agents living in the same process. When you launch several agents in
 * different terminals, each has its own (empty) bridge, and only the process
 * that won the port-3001 race actually serves the dashboard — so the UI would
 * show a single agent.
 *
 * This client fixes that by sending every register/update over HTTP to the one
 * running dashboard server (http://localhost:3001). All agents, regardless of
 * process, funnel their snapshots into the same server-side bridge.
 *
 * Calls are fire-and-forget: failures are swallowed so the agent loop is never
 * blocked or crashed by dashboard connectivity issues.
 */

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001';

/**
 * Registers an agent with the dashboard server.
 * @param {string} agentId
 * @param {{width:number,height:number,tiles:any[][]}} worldMap
 */
export function registerAgent(agentId, worldMap) {
    post('/ingest/register', { agentId, worldMap });
}

/**
 * Pushes a fresh snapshot for an agent to the dashboard server.
 * @param {string} agentId
 * @param {object} snapshot
 */
export function update(agentId, snapshot) {
    post('/ingest/update', { agentId, snapshot });
}

/** Fire-and-forget JSON POST. Never throws. */
function post(pathname, body) {
    // globalThis.fetch is available in Node 18+.
    fetch(`${DASHBOARD_URL}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {
        // Dashboard may not be up yet, or this process couldn't reach it.
        // Ignore silently so the agent keeps running.
    });
}

// Provide a bridge-compatible default export so call sites that used
// `bridge.registerAgent(...)` / `bridge.update(...)` can switch with minimal
// changes.
export const dashboardClient = { registerAgent, update };
export default dashboardClient;
