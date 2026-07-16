import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridge } from './DashboardBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

app.get('/api/state', (req, res) => {
    const state = bridge.getState();
    const obj = {};
    for (const [k, v] of state.entries()) {
        obj[k] = v;
    }
    res.json(obj);
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const state = bridge.getState();
    const obj = {};
    for (const [k, v] of state.entries()) {
        obj[k] = v;
    }
    res.write(`data: ${JSON.stringify({ type: 'init', state: obj })}\n\n`);

    const listener = (agentId, snapshot) => {
        res.write(`data: ${JSON.stringify({ type: 'update', agentId, snapshot })}\n\n`);
    };

    bridge.on('update', listener);

    req.on('close', () => {
        bridge.off('update', listener);
    });
});

app.listen(PORT, () => {
    console.log(`Dashboard server listening on http://localhost:${PORT}`);
});
