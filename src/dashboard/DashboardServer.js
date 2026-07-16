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

app.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/style.css', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'style.css'));
});

app.get('/api/state', (_req, res) => {
    res.json(serializeState());
});

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

app.listen(PORT, () => {
    console.log(`📊 Dashboard server running at http://localhost:${PORT}`);
});

export default app;
