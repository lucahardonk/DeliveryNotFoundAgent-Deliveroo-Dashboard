// tools.js
// High-level tool functions, called directly by parser.js when executing a plan.
// Ollama never calls these — it only outputs the JSON plan; parser.js does the dispatch.

import { appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { stepToward } from './functions.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, 'memory.txt'); // same file promptBuilder.js reads

const AGENT4_MCP_URL = process.env.AGENT4_MCP_URL
    ?? `http://localhost:${process.env.AGENT4_MCP_PORT ?? 3001}/mcp`;

// ── Yield control back to Node's event loop ──────────────────────────────────
function releaseEventLoop(ms = 50) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── MCP client helper (server is stateless → fresh client per call) ─────────

async function callAgent4Tool(name, args = {}) {
    const transport = new StreamableHTTPClientTransport(new URL(AGENT4_MCP_URL));
    const client = new Client({ name: 'matteo-tools-client', version: '1.0.0' });

    try {
        await client.connect(transport);
        const res = await client.callTool({ name, arguments: args });

        const raw = res?.content?.[0]?.text;
        if (!raw) return { success: false, message: 'agent4: empty MCP response' };

        const parsed = JSON.parse(raw);
        return {
            success: parsed.success ?? !parsed.error,
            message: parsed.message ?? parsed.error ?? JSON.stringify(parsed),
            raw: parsed, // keep full object around (carrying, parcelsVisible, etc.)
        };
    } catch (e) {
        return { success: false, message: `agent4 MCP error: ${e.message}` };
    } finally {
        await transport.close().catch(() => {});
    }
}

// ── Local tools (Matteo, this process) — signature: (agent, args) ───────────

export async function move_to(agent, args = {}) {
    const { x, y } = args;
    const target = { x, y };
    while (!agent.world.isAt(target)) {
        const moved = await stepToward(agent, target);
        if (!moved) return { success: false, message: `blocked or no path to (${x},${y})` };
        await releaseEventLoop();
    }
    return { success: true, message: `arrived at (${x},${y})` };
}

export async function pick_up_parcel(agent) {
    const ok = await agent.io.doPickup();
    if (ok) await releaseEventLoop();
    return ok
        ? { success: true, message: 'parcel picked up' }
        : { success: false, message: 'no parcel to pick up here' };
}

export async function put_down_parcel(agent) {
    const ok = await agent.io.doPutdown();
    if (ok) await releaseEventLoop();
    return ok
        ? { success: true, message: 'parcel(s) put down' }
        : { success: false, message: 'could not put down here' };
}

export async function find_and_get_a_parcel(agent) {
    const me = agent.world.me;
    const free = agent.world.freeParcels();

    // ── Caso 1: c'è già un parcel visibile → vai e prendilo ──
    if (free.length > 0) {
        free.sort((a, b) =>
            (Math.abs(a.x - me.x) + Math.abs(a.y - me.y)) -
            (Math.abs(b.x - me.x) + Math.abs(b.y - me.y))
        );
        const target = free[0];

        const moveResult = await move_to(agent, { x: target.x, y: target.y });
        if (!moveResult.success) return moveResult;

        return pick_up_parcel(agent);
    }

    // ── Caso 2: nessun parcel visibile → esplora verso uno spawner entro RADIUS ──
    const RADIUS = 10;
    const spawnTiles = (agent.world.map?.spawnerTiles ?? [])
        .filter((t) => Math.abs(t.x - me.x) + Math.abs(t.y - me.y) <= RADIUS);

    if (spawnTiles.length === 0) {
        return { success: false, message: 'no free parcels known and no spawner tiles in range' };
    }

    const randomTile = spawnTiles[Math.floor(Math.random() * spawnTiles.length)];
    const moveResult = await move_to(agent, { x: randomTile.x, y: randomTile.y });

    if (!moveResult.success) {
        return { success: false, message: `no free parcels known; failed to reach spawner tile (${randomTile.x},${randomTile.y})` };
    }

    // Dopo lo spostamento, se un parcel è apparso proprio qui, prendilo.
    const parcelHere = agent.world.parcelHere();
    if (parcelHere) {
        return pick_up_parcel(agent);
    }

    // Altrimenti fallimento: non ha visto/preso nulla in tempo.
    return { success: false, message: `no free parcels known; explored spawner tile (${randomTile.x},${randomTile.y}) but found nothing` };
}

export function calculator(_agent, args = {}) {
    const { expression } = args;
    if (typeof expression !== 'string' || !/^[0-9+\-*/().\s]+$/.test(expression)) {
        return { success: false, message: 'invalid characters in expression' };
    }
    try {
        // eslint-disable-next-line no-new-func
        const value = Function(`"use strict"; return (${expression});`)();
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return { success: false, message: 'expression did not evaluate to a finite number' };
        }
        return { success: true, message: String(value) };
    } catch (e) {
        return { success: false, message: `invalid expression: ${e.message}` };
    }
}

export function add_to_memory(_agent, args = {}) {
    const { text } = args;
    if (typeof text !== 'string' || text.trim().length === 0) {
        return { success: false, message: 'empty memory text' };
    }
    try {
        appendFileSync(MEMORY_FILE, `- ${text.trim()}\n`, 'utf-8');
        return { success: true, message: `memory saved: "${text.trim()}"` };
    } catch (e) {
        return { success: false, message: `could not write memory: ${e.message}` };
    }
}

// ── NPC tools (agent4, via MCP) — signature: (agent, args) ───────────────────

export async function agent_move_to(_agent, args = {}) {
    return callAgent4Tool('goto_agent', { x: args.x, y: args.y });
}

export async function agent_pick_up_parcel() {
    return callAgent4Tool('pickup_agent');
}

export async function agent_put_down_parcel() {
    return callAgent4Tool('putdown_agent');
}

export async function agent_find_and_get_a_parcel() {
    return callAgent4Tool('find_and_get_parcel_agent');
}

// Fetches agent4's current state (position, carrying count, visible parcels)
// and caches it on `agent.agent4State` so evaluateCondition (sync) can read it.
export async function agent_get_state(agent) {
    const result = await callAgent4Tool('get_agent_state');
    if (result.success !== false && result.raw) {
        agent.agent4State = {
            carrying: result.raw.carrying ?? 0,
            parcelsVisible: result.raw.parcelsVisible ?? 0,
            position: result.raw.position,
            score: result.raw.score,
        };
        return { success: true, message: `agent4 state refreshed: carrying=${agent.agent4State.carrying}, parcelsVisible=${agent.agent4State.parcelsVisible}` };
    }
    return { success: false, message: result.message ?? 'failed to fetch agent4 state' };
}

// ── Registry used by parser.js (plan execution) ──────────────────────────────
// Usage: await TOOL_FNS[step.tool](agent, step.args ?? {})

export const TOOL_FNS = {
    move_to,
    pick_up_parcel,
    put_down_parcel,
    find_and_get_a_parcel,
    calculator,
    add_to_memory,
    agent_move_to,
    agent_pick_up_parcel,
    agent_put_down_parcel,
    agent_find_and_get_a_parcel,
    agent_get_state,
};

// List of condition names that require a fresh agent4 state before evaluation.
// parser.js should call agent_get_state(agent) before evaluating conditions
// whose name is in this set.
export const AGENT4_CONDITIONS = new Set([
    'agent_carrying_less_than',
    'agent_carrying_at_least',
    'agent_free_parcels_exist',
]);

// ── Condition evaluator (used by parser.js for if/loop) ──────────────────────
// Usage: evaluateCondition(agent, { condition: "carrying_at_least", args: { n: 1 } })
// NOTE: this stays synchronous. For agent_* conditions it reads the cached
// `agent.agent4State`, which parser.js must refresh via agent_get_state(agent)
// before calling evaluateConditions() whenever the condition list contains
// any name from AGENT4_CONDITIONS.

export function evaluateCondition(agent, condition) {
    const { condition: name, args = {} } = condition;
    switch (name) {
        case 'carrying_less_than':
            return agent.world.carrying().length < args.n;
        case 'carrying_at_least':
            return agent.world.carrying().length >= args.n;
        case 'free_parcels_exist':
            return agent.world.freeParcels().length > 0;
        case 'at_delivery_tile':
            return agent.world.atDelivery();
        case 'agent_carrying_less_than':
            return (agent.agent4State?.carrying ?? 0) < args.n;
        case 'agent_carrying_at_least':
            return (agent.agent4State?.carrying ?? 0) >= args.n;
        case 'agent_free_parcels_exist':
            return (agent.agent4State?.parcelsVisible ?? 0) > 0;
        default:
            console.warn(`[tools] unknown condition: ${name}`);
            return false;
    }
}