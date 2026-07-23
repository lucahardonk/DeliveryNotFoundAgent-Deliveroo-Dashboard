import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Standalone dashboard server.
 *
 * This module is fully decoupled from the agents: it knows nothing about the
 * Deliveroo SDK, the strategies, or how agents are launched. Agents (possibly
 * in other processes or on other machines) simply POST their latest state to
 * the REST API below, and the browser UI polls it back out.
 *
 * REST API
 *   POST /api/agents/:id/state   ingest one agent's latest snapshot
 *   GET  /api/agents             list only the ACTIVE agent snapshots
 *   GET  /api/agents/:id         one agent snapshot (if still active)
 *   DELETE /api/agents           clear all (useful between runs)
 *   GET  /                       serve the live UI
 *
 * Active-agents only
 *   Agents report their state a few times per second (fire-and-forget). An
 *   agent is considered ACTIVE only while it keeps reporting: if it hasn't
 *   posted within AGENT_TTL_MS it is treated as gone and dropped from the
 *   store. This way the dashboard always shows exactly as many agents as there
 *   are active tokens — stale agents left over from a previous run (e.g. when
 *   you ran 2 tokens and now run 1) automatically disappear.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.DASHBOARD_PORT) || 3001;

/**
 * How long (ms) since an agent's last report before we consider it gone.
 * Agents report every ~200ms, so a few seconds of silence means it stopped.
 */
const AGENT_TTL_MS = Number(process.env.AGENT_TTL_MS) || 5000;

/** In-memory store: agentId -> latest snapshot. */
const agents = new Map();

/** Remove agents that haven't reported within AGENT_TTL_MS. */
function pruneStale() {
    const cutoff = Date.now() - AGENT_TTL_MS;
    for (const [id, snap] of agents) {
        if ((snap.receivedAt ?? 0) < cutoff) agents.delete(id);
    }
}

// Sweep periodically so agents drop off even if nobody is polling.
setInterval(pruneStale, 1000).unref?.();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/api/agents/:id/state', (req, res) => {
    const id = req.params.id;
    agents.set(id, { ...req.body, id, receivedAt: Date.now() });
    res.json({ ok: true });
});

app.get('/api/agents', (_req, res) => {
    pruneStale();
    res.json(Object.fromEntries(agents));
});

app.get('/api/agents/:id', (req, res) => {
    pruneStale();
    const snap = agents.get(req.params.id);
    if (!snap) return res.status(404).json({ error: 'not found' });
    res.json(snap);
});

app.delete('/api/agents', (_req, res) => {
    agents.clear();
    res.json({ ok: true });
});

app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
    console.log(`📊 Dashboard running at http://localhost:${PORT}`);
});

export default app;
