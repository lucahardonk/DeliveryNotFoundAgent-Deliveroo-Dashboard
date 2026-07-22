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
 *   GET  /api/agents             list every known agent snapshot
 *   GET  /api/agents/:id         one agent snapshot
 *   DELETE /api/agents           clear all (useful between runs)
 *   GET  /                       serve the live UI
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.DASHBOARD_PORT) || 3001;

/** In-memory store: agentId -> latest snapshot. */
const agents = new Map();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/api/agents/:id/state', (req, res) => {
    const id = req.params.id;
    agents.set(id, { ...req.body, id, receivedAt: Date.now() });
    res.json({ ok: true });
});

app.get('/api/agents', (_req, res) => {
    res.json(Object.fromEntries(agents));
});

app.get('/api/agents/:id', (req, res) => {
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
