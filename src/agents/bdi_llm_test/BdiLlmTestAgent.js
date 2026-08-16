// src/agents/bdi_llm_test/BdiLlmTestAgent.js
import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const MCP_PORT = Number(process.env.AGENT4_MCP_PORT ?? 3001);

export class BdiLlmTestAgent {
    constructor({ name, host, dashboardUrl }) {
        this.name = name;
        this.host = host;
        this.dashboardUrl = dashboardUrl;

        this.socket = null;
        this.map = null;
        this.me = null;
        this.parcels = [];
        this.agents = [];

        this.httpServer = null;
    }

    async setup(token) {
        this.socket = DjsConnect(this.host, token);

        const mapReady = new Promise((res) => {
            this.socket.onMap((width, height, tiles) => {
                this.map = { width, height, tiles };
                console.log(`[${this.name}] map: ${width}x${height}`);
                res();
            });
        });

        const youReady = new Promise((res) => {
            this.socket.onYou((you) => {
                this.me = you;
                res();
            });
        });

        if (typeof this.socket.onParcelsSensing === 'function') {
            this.socket.onParcelsSensing((parcels) => {
                this.parcels = parcels;
            });
        } else if (typeof this.socket.onSensing === 'function') {
            this.socket.onSensing((sensing) => {
                this.parcels = sensing?.parcels ?? [];
                this.agents = sensing?.agents ?? this.agents;
            });
        }

        if (typeof this.socket.onAgentsSensing === 'function') {
            this.socket.onAgentsSensing((agents) => {
                this.agents = agents;
            });
        }

        await Promise.all([mapReady, youReady]);
        console.log(`🤖 [${this.name}] connected as ${this.me?.name ?? this.me?.id}`);

        await this.startMcpServer(MCP_PORT);
    }

    // ── Pathfinding: BFS sulla propria mappa → lista di direzioni ────────────
    findPath(goal) {
        if (!this.map || !this.me) return null;

        // NOTA: adatta il filtro se il tuo formato tile è diverso
        // (qui: t.type !== 0 = camminabile; alcuni SDK usano t.locked o t.walkable)
        const walkable = new Set(
            this.map.tiles
                .filter((t) => t.type !== 0 && !t.locked)
                .map((t) => `${t.x},${t.y}`),
        );
        if (!walkable.has(`${goal.x},${goal.y}`)) return null;

        const start = { x: Math.round(this.me.x), y: Math.round(this.me.y) };
        if (start.x === goal.x && start.y === goal.y) return [];

        const key = (x, y) => `${x},${y}`;
        const cameFrom = new Map();
        const visited = new Set([key(start.x, start.y)]);
        let frontier = [start];
        const deltas = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'right'], [-1, 0, 'left']];

        while (frontier.length) {
            const next = [];
            for (const cur of frontier) {
                for (const [dx, dy, dir] of deltas) {
                    const nx = cur.x + dx, ny = cur.y + dy;
                    const k = key(nx, ny);
                    if (visited.has(k) || !walkable.has(k)) continue;
                    visited.add(k);
                    cameFrom.set(k, { from: key(cur.x, cur.y), dir });
                    if (nx === goal.x && ny === goal.y) {
                        const dirs = [];
                        let ck = k;
                        while (cameFrom.has(ck)) {
                            const { from, dir } = cameFrom.get(ck);
                            dirs.unshift(dir);
                            ck = from;
                        }
                        return dirs;
                    }
                    next.push({ x: nx, y: ny });
                }
            }
            frontier = next;
        }
        return null;
    }

    // ── MCP server: espone i comandi di questo agente come tool ──────────────
    // Modalità STATELESS: un nuovo McpServer + transport per OGNI richiesta POST.

    buildMcpServer() {
        const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
        const pos = () => ({ x: this.me?.x, y: this.me?.y });

        const server = new McpServer({ name: 'agent4', version: '1.0.0' });

        server.tool(
            'move_agent',
            'Move Agent4 one step in a direction: up/down/left/right. Optionally repeat n times.',
            { direction: z.enum(['up', 'down', 'left', 'right']), n: z.number().int().min(1).max(20).optional() },
            async ({ direction, n = 1 }) => {
                for (let i = 0; i < n; i++) {
                    const ok = await this.socket.emitMove(direction);
                    if (!ok) return text({ error: `move ${direction} failed at step ${i + 1} (blocked?)`, position: pos() });
                }
                return text({ success: true, position: pos() });
            },
        );

        server.tool(
            'goto_agent',
            'Move Agent4 to coordinates (x,y) using pathfinding.',
            { x: z.number().int(), y: z.number().int() },
            async ({ x, y }) => {
                const dirs = this.findPath({ x, y });
                if (!dirs) return text({ error: `No path to (${x},${y}) or tile not walkable`, position: pos() });
                for (const dir of dirs) {
                    const ok = await this.socket.emitMove(dir);
                    if (!ok) return text({ error: `move ${dir} failed en route to (${x},${y})`, position: pos() });
                }
                return text({ success: true, position: pos() });
            },
        );

        server.tool(
            'pickup_agent',
            'Agent4 picks up the parcel on its current tile.',
            {},
            async () => {
                const result = await this.socket.emitPickup();
                return text({ success: true, result, position: pos() });
            },
        );

        server.tool(
            'putdown_agent',
            'Agent4 puts down all carried parcels on its current tile.',
            {},
            async () => {
                const result = await this.socket.emitPutdown();
                return text({ success: true, result, position: pos() });
            },
        );

        server.tool(
            'get_agent_state',
            'Get Agent4 current position and nearby parcels/agents.',
            {},
            async () => text({
                position: pos(),
                score: this.me?.score,
                parcelsVisible: this.parcels.length,
                agentsVisible: this.agents.length,
            }),
        );

        return server;
    }

    async startMcpServer(port) {
        const app = express();
        app.use(express.json());

        app.post('/mcp', async (req, res) => {
            try {
                const server = this.buildMcpServer();
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                res.on('close', () => { transport.close(); server.close(); });
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            } catch (e) {
                console.error(`[${this.name}] MCP request error:`, e.message);
                if (!res.headersSent) {
                    res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null });
                }
            }
        });

        // In modalità stateless GET (SSE) e DELETE non sono supportati.
        const notAllowed = (req, res) => res.status(405).json({
            jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null,
        });
        app.get('/mcp', notAllowed);
        app.delete('/mcp', notAllowed);

        await new Promise((res) => {
            this.httpServer = app.listen(port, () => {
                console.log(`🔌 [${this.name}] MCP server on http://localhost:${port}/mcp`);
                res();
            });
        });
    }

    async loop() {
        // Idle: this agent only acts when commanded via MCP tools.
    }
}