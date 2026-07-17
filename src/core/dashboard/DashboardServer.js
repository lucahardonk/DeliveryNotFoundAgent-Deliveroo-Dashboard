import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridge } from './DashboardBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = 3001;

/** Serializes the bridge state Map into a plain object for JSON transport. */
function serializeState() {
    const obj = {};
    for (const [agentId, snapshot] of bridge.getState()) {
        obj[agentId] = snapshot;
    }
    return obj;
}

const app = express();

// Parse JSON bodies (needed for agent ingestion). Large maps can be big.
app.use(express.json({ limit: '10mb' }));

// ── Agent data ingestion (HTTP) ─────────────────────────────────────────
// These endpoints let agents running in SEPARATE Node processes push their
// state to the single dashboard server. Each `node src/main.js` is its own
// process with its own in-memory bridge, so cross-process data must travel
// over HTTP to reach the one server that serves the dashboard.

app.post('/ingest/register', (req, res) => {
    const { agentId, worldMap } = req.body || {};
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    bridge.registerAgent(agentId, worldMap);
    res.json({ ok: true });
});

app.post('/ingest/update', (req, res) => {
    const { agentId, snapshot } = req.body || {};
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    bridge.update(agentId, snapshot);
    res.json({ ok: true });
});

// Serve main dashboard (all agents)
app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Serve individual agent view
app.get('/agent/:id', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'agent.html'));
});

app.get('/style.css', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'style.css'));
});

// API: get all agents state
app.get('/api/state', (_req, res) => {
    res.json(serializeState());
});

// API: get single agent state
app.get('/api/agent/:id', (req, res) => {
    const agentId = req.params.id;
    const snapshot = bridge.getState().get(agentId);
    if (!snapshot) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(snapshot);
});

// SSE: stream all agents updates
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // Send a full state dump as the first event.
    res.write(`data: ${JSON.stringify({ type: 'init', state: serializeState() })}\n\n`);

    // Forward every subsequent bridge update to this client.
    const listener = ({ agentId, snapshot }) => {
        res.write(`data: ${JSON.stringify({ type: 'update', agentId, snapshot })}\n\n`);
    };
    bridge.on('update', listener);

    // Clean up the listener when the client disconnects.
    req.on('close', () => {
        bridge.off('update', listener);
    });
});

// SSE: stream single agent updates
app.get('/events/:id', (req, res) => {
    const focusAgentId = req.params.id;
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    // Send initial state for this agent
    const snapshot = bridge.getState().get(focusAgentId);
    if (snapshot) {
        res.write(`data: ${JSON.stringify({ type: 'init', snapshot })}\n\n`);
    }

    // Forward only updates for this agent
    const listener = ({ agentId, snapshot }) => {
        if (agentId === focusAgentId) {
            res.write(`data: ${JSON.stringify({ type: 'update', snapshot })}\n\n`);
        }
    };
    bridge.on('update', listener);

    req.on('close', () => {
        bridge.off('update', listener);
    });
});

// Singleton server: only start once
let serverInstance = null;

function startServer() {
    if (serverInstance) {
        console.log(`📊 Dashboard server already running at http://localhost:${PORT}`);
        return serverInstance;
    }

    serverInstance = app.listen(PORT, () => {
        console.log(`📊 Dashboard server running at http://localhost:${PORT}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`📊 Dashboard server already running at http://localhost:${PORT}`);
        } else {
            console.error('Dashboard server error:', err);
        }
    });

    return serverInstance;
}

// Auto-start the server when this module is imported
startServer();

export default app;
