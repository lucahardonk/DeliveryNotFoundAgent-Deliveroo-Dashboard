import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT       = Number(process.env.DASHBOARD_PORT) || 3001;
const AGENT_TTL_MS = Number(process.env.AGENT_TTL_MS) || 5000;

// ── State ─────────────────────────────────────────────────────────────────────

/** agentId -> latest snapshot */
const agents = new Map();

function pruneStale() {
    const cutoff = Date.now() - AGENT_TTL_MS;
    for (const [id, snap] of agents)
        if ((snap.receivedAt ?? 0) < cutoff) agents.delete(id);
}

// Sweep stale agents even when no browser is connected.
setInterval(pruneStale, 1000).unref?.();

// ── SSE broadcast ─────────────────────────────────────────────────────────────

/** One entry per open browser tab. */
const sseClients = new Set();

/**
 * Pushes the full agents snapshot to every connected browser instantly.
 * Called after every agent POST so the UI updates in real time.
 */
function broadcast() {
    pruneStale();
    const payload = `event: agents\ndata: ${JSON.stringify(Object.fromEntries(agents))}\n\n`;
    for (const res of sseClients) {
        try { res.write(payload); }
        catch { sseClients.delete(res); }
    }
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));

// Ingest agent snapshot — triggers an immediate SSE push to all browsers.
app.post('/api/agents/:id/state', (req, res) => {
    agents.set(req.params.id, { ...req.body, id: req.params.id, receivedAt: Date.now() });
    res.json({ ok: true });
    broadcast();
});

// REST fallback (used for the initial load or non-SSE clients).
app.get('/api/agents', (_req, res) => {
    pruneStale();
    res.json(Object.fromEntries(agents));
});

app.get('/api/agents/:id', (req, res) => {
    pruneStale();
    const snap = agents.get(req.params.id);
    snap ? res.json(snap) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/agents', (_req, res) => {
    agents.clear();
    broadcast();
    res.json({ ok: true });
});

// SSE stream — browser connects once and receives pushes for the entire session.
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    // Send current state immediately so the UI isn't blank on load.
    pruneStale();
    res.write(`event: agents\ndata: ${JSON.stringify(Object.fromEntries(agents))}\n\n`);

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

// Static files + SPA fallback.
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => console.log(`📊 Dashboard running at http://localhost:${PORT}`));

export default app;