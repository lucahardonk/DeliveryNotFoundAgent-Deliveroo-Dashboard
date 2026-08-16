// LlmAgent: versione "realtime" robusta per modelli con context length ridotta.
//   1) pre-processing: valuta espressioni matematiche e controlla punti negativi
//   2) comandi semplici parsati deterministicamente (no LLM)
//   3) altrimenti l'LLM produce UN piano breve (submit_plan, con retry + fallback)
//   4) il codice esegue gli step; al primo errore ripianifica UNA volta
//   5) lock anti-concorrenza: una missione alla volta
//   6) MCP client: controlla Agent4 (bdi_llm_test) via tool remoti (move_agent, ...)

import "dotenv/config";
import OpenAI from "openai";
import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk/client";
import { ChatServer } from "./Chat.js";
import { WorldModel } from "./WorldModel.js";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseURL = process.env.LITELLM_BASE_URL || "https://llm.bears.disi.unitn.it/v1";
const apiKey = process.env.LITELLM_API_KEY;
const MODEL = process.env.LOCAL_MODEL || "llama-3.3-70b-lmstudio";
const MCP_URL = process.env.AGENT4_MCP_URL || "http://localhost:3001/mcp";

if (!apiKey) {
    console.error("Error: missing LITELLM_API_KEY in .env file");
    process.exit(1);
}

console.log(`Using OpenAI-like service at ${baseURL} with model ${MODEL}`);

const client = new OpenAI({ baseURL, apiKey });

// ── Costanti ─────────────────────────────────────────────────────────────────
// let: viene esteso a runtime con i tool MCP scoperti da Agent4
let ALLOWED_STEP_TOOLS = ["move", "go_to", "pickup", "putdown", "plan_and_deliver", "calculate"];
const MAX_MISSION_STEPS = 30;
const MAX_REPLANS = 1;
const MAX_PLAN_ATTEMPTS = 2;
const MAX_CHAT_MESSAGES = 20;

const ACTION_REGEX = /\b(move|go|walk|up|down|left|right|pick\s?up|pickup|putdown|put\s?down|deliver|delivery|drop|grab|collect|tile|coordinate|vai|muoviti|spostati|su|giù|giu|sinistra|destra|raccogli|prendi|consegna|porta|lascia|posa|agent\s?4)\b/i;

// Costruito on-demand così l'enum riflette anche i tool MCP aggiunti a runtime
function buildPlanningTools() {
    return [
        {
            type: "function",
            function: {
                name: "submit_plan",
                description: "Submit the final short list of steps to reach the goal now.",
                parameters: {
                    type: "object",
                    properties: {
                        status: { type: "string", enum: ["ready", "blocked"] },
                        reason: { type: "string" },
                        steps: {
                            type: "array",
                            maxItems: 8,
                            items: {
                                type: "object",
                                properties: {
                                    tool: { type: "string", enum: ALLOWED_STEP_TOOLS },
                                    args: { type: "object" },
                                    expectedPointChange: { type: "number" },
                                },
                                required: ["tool", "args", "expectedPointChange"],
                            },
                        },
                    },
                    required: ["status", "reason", "steps"],
                },
            },
        },
    ];
}

// ── Utility ──────────────────────────────────────────────────────────────────
function getExplicitPointChange(text) {
    const m = text.match(/([+-]?\d+(?:\.\d+)?)\s*(?:p|pt|pts|points?|punti)\b/i);
    if (!m) return null;
    let val = Number(m[1]);
    if (/\b(lose|loose|losing|loss|perdere|perdi|perdita)\b/i.test(text) && val > 0) val = -val;
    return val;
}

function preEvalMath(text) {
    return text.replace(/([xy])\s*=\s*([0-9+\-*/(). ]+)/gi, (full, axis, expr) => {
        try {
            const val = Function(`"use strict";return(${expr.trim()})`)();
            return Number.isFinite(val) ? `${axis}=${val}` : full;
        } catch {
            return full;
        }
    });
}

function sanitizeChatResponse(text) {
    return String(text ?? "")
        .replace(/<\|?tool_call\|?>[\s\S]*/gi, "")
        .replace(/<\|[^|]*\|>/g, "")
        .trim();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Parser deterministico per comandi semplici: niente LLM per "vai su di 2".
function parseSimpleCommand(text) {
    const t = text.toLowerCase().trim();
    const dirMap = { su: "up", "giù": "down", giu: "down", sinistra: "left", destra: "right", up: "up", down: "down", left: "left", right: "right" };

    // ── Fast-path Agent4 (tool MCP remoti) ───────────────────────────────────
    if (/\bagent\s?4\b|\baltro\s+agente\b/.test(t)) {
        // "move agent4 to 0,0" / "vai con agent4 a (3,5)" / "agent4 in 0 0"
        const g4 = t.match(/(?:vai\s+a|go\s+to|move.*?to|in|at|a)\s*\(?\s*(\d+)\s*[,;\s]\s*(\d+)\s*\)?/);
        if (g4) {
            return {
                reason: `Muovo Agent4 a (${g4[1]}, ${g4[2]}).`,
                steps: [{ tool: "goto_agent", args: { x: Number(g4[1]), y: Number(g4[2]) }, expectedPointChange: 0 }],
            };
        }
        const m4 = t.match(/\b(su|giù|giu|sinistra|destra|up|down|left|right)\b(?:\s*(?:di|by|of)?\s*(\d+))?/);
        if (m4) {
            const n = Math.min(Number(m4[2] || 1), 20);
            return {
                reason: `Muovo Agent4 di ${n} casella/e verso ${dirMap[m4[1]]}.`,
                steps: [{ tool: "move_agent", args: { direction: dirMap[m4[1]], n }, expectedPointChange: 0 }],
            };
        }
        if (/\b(pick\s?up|raccogli|prendi|grab|collect)\b/.test(t)) {
            return { reason: "Agent4 raccoglie il pacco.", steps: [{ tool: "pickup_agent", args: {}, expectedPointChange: 0 }] };
        }
        if (/\b(putdown|put\s?down|drop|posa|lascia)\b/.test(t)) {
            return { reason: "Agent4 posa i pacchi.", steps: [{ tool: "putdown_agent", args: {}, expectedPointChange: 0 }] };
        }
        return null; // altro su Agent4 → lascia decidere al planner LLM
    }

    const makeMoves = (dir, n) => ({
        reason: `Muovo ${n} casella/e verso ${dir}.`,
        steps: Array.from({ length: n }, () => ({ tool: "move", args: { direction: dir }, expectedPointChange: 0 })),
    });

    const m = t.match(/(?:vai|go|move|muoviti|spostati|walk)\s+(su|giù|giu|sinistra|destra|up|down|left|right)(?:\s+(?:di|by|of)?\s*(\d+))?/);
    if (m) return makeMoves(dirMap[m[1]], Math.min(Number(m[2] || 1), MAX_MISSION_STEPS));

    const bare = t.match(/^(su|giù|giu|sinistra|destra|up|down|left|right)(?:\s*(?:di|by|of)?\s*(\d+))?(?:\s*(?:times|volte|tiles|caselle))?$/);
    if (bare) return makeMoves(dirMap[bare[1]], Math.min(Number(bare[2] || 1), MAX_MISSION_STEPS));

    const g = t.match(/(?:vai\s+a|go\s+to|move\s+to)\s*(?:coordinates?\s*)?\(?\s*(?:x\s*=\s*)?(\d+)\s*[,;\s]\s*(?:y\s*=\s*)?(\d+)\s*\)?/);
    if (g) {
        return {
            reason: `Vado a (${g[1]}, ${g[2]}).`,
            steps: [{ tool: "go_to", args: { x: Number(g[1]), y: Number(g[2]) }, expectedPointChange: 0 }],
        };
    }

    if (/^(raccogli|prendi(\s+il\s+pacco)?|pick\s?up|grab|collect)\b/.test(t) && !/consegna|deliver|drop/.test(t)) {
        return { reason: "Raccolgo il pacco qui.", steps: [{ tool: "pickup", args: {}, expectedPointChange: 0 }] };
    }

    if (/\b(consegna|deliver|porta)\b/.test(t) && !/\b(leftmost|rightmost|topmost|bottommost|più a|piu a)\b/.test(t)) {
        return {
            reason: "Eseguo pickup e consegna del pacco migliore raggiungibile.",
            steps: [{ tool: "plan_and_deliver", args: {}, expectedPointChange: 1 }],
        };
    }

    return null;
}

// ── A* pathfinding ───────────────────────────────────────────────────────────
function astar(world, start, goal) {
    const key = (n) => `${n.x},${n.y}`;
    const h = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    if (!world.walkable(goal.x, goal.y)) return null;

    const open = new Map([[key(start), { ...start, g: 0, f: h(start, goal) }]]);
    const cameFrom = new Map();
    const gScore = new Map([[key(start), 0]]);
    const closed = new Set();

    while (open.size) {
        let currentKey = null, current = null;
        for (const [k, n] of open) {
            if (!current || n.f < current.f) { current = n; currentKey = k; }
        }

        if (current.x === goal.x && current.y === goal.y) {
            const path = [{ x: current.x, y: current.y }];
            let ck = currentKey;
            while (cameFrom.has(ck)) {
                ck = cameFrom.get(ck);
                const [x, y] = ck.split(",").map(Number);
                path.unshift({ x, y });
            }
            return path;
        }

        open.delete(currentKey);
        closed.add(currentKey);

        const neighbors = [
            { x: current.x, y: current.y - 1 },
            { x: current.x, y: current.y + 1 },
            { x: current.x - 1, y: current.y },
            { x: current.x + 1, y: current.y },
        ];

        for (const n of neighbors) {
            const nKey = key(n);
            if (closed.has(nKey)) continue;
            if (!world.walkable(n.x, n.y)) continue;

            const tentativeG = gScore.get(currentKey) + 1;
            if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
                cameFrom.set(nKey, currentKey);
                gScore.set(nKey, tentativeG);
                open.set(nKey, { ...n, g: tentativeG, f: tentativeG + h(n, goal) });
            }
        }
    }

    return null;
}

function pathToDirections(path) {
    const directions = [];
    for (let i = 1; i < path.length; i++) {
        const dx = path[i].x - path[i - 1].x;
        const dy = path[i].y - path[i - 1].y;
        if (dx === 1) directions.push("right");
        else if (dx === -1) directions.push("left");
        else if (dy === 1) directions.push("up");
        else if (dy === -1) directions.push("down");
    }
    return directions;
}

// BFS multi-target: distanze verso tutti i candidati in UNA passata.
function nearestReachable(world, start, candidates) {
    if (!candidates.length) return null;
    const targets = new Map(candidates.map((c) => [`${c.x},${c.y}`, c]));
    const key = (x, y) => `${x},${y}`;
    const cameFrom = new Map();
    const visited = new Set([key(start.x, start.y)]);
    let frontier = [{ x: start.x, y: start.y }];

    const buildPath = (endKey) => {
        const path = [];
        let ck = endKey;
        while (ck) {
            const [x, y] = ck.split(",").map(Number);
            path.unshift({ x, y });
            ck = cameFrom.get(ck);
        }
        return path;
    };

    if (targets.has(key(start.x, start.y))) {
        return { target: targets.get(key(start.x, start.y)), path: [{ ...start }], steps: 0 };
    }

    while (frontier.length) {
        const next = [];
        for (const cur of frontier) {
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cur.x + dx, ny = cur.y + dy;
                const nKey = key(nx, ny);
                if (visited.has(nKey) || !world.walkable(nx, ny)) continue;
                visited.add(nKey);
                cameFrom.set(nKey, key(cur.x, cur.y));
                if (targets.has(nKey)) {
                    const path = buildPath(nKey);
                    return { target: targets.get(nKey), path, steps: path.length - 1 };
                }
                next.push({ x: nx, y: ny });
            }
        }
        frontier = next;
    }
    return null;
}

export class LlmAgent {
    constructor({ name, host, dashboardUrl }) {
        this.name = name;
        this.host = host;
        this.dashboardUrl = dashboardUrl;

        this.socket = null;
        this.world = new WorldModel();
        this.me = null;
        this.currentMission = null;
        this.busy = false;

        // MCP client verso Agent4
        this.mcp = null;
        this.mcpToolNames = new Set();

        this.model = MODEL;
        this.messages = [
            {
                role: "system",
                content:
                    `You are ${name}, a Deliveroo game agent. ` +
                    `Reply briefly in plain text. Never output tool-call syntax, ` +
                    `special tokens, or function names.`,
            },
        ];

        this.chatServer = new ChatServer({ agent: this, port: 8090 });
    }

    async setup(token) {
        this.socket = DjsConnect(this.host, token);

        const mapReady = new Promise((res) => {
            this.socket.onMap((width, height, tiles) => {
                this.world.buildMap(tiles);
                console.log(`[${this.name}] map: ${width}x${height}`);
                res();
            });
        });

        const youReady = new Promise((res) => {
            this.socket.onYou((you) => {
                this.world.updateMe(you);
                this.me = this.world.me;
                res();
            });
        });

        if (typeof this.socket.onParcelsSensing === "function") {
            this.socket.onParcelsSensing((parcels) => { this.world.updateParcels(parcels); });
        }
        if (typeof this.socket.onAgentsSensing === "function") {
            this.socket.onAgentsSensing((agents) => { this.world.others = agents; });
        }

        await Promise.all([mapReady, youReady]);
        console.log(`🤖 [${this.name}] connected as ${this.world.me?.name ?? this.world.me?.id} at (${this.world.me?.x}, ${this.world.me?.y})`);

        this.chatServer.start();
        console.log(`💬 [${this.name}] chat UI → http://localhost:8090`);

        await this.setupMcp();
    }

    // ── MCP client: scopre e registra i tool esposti da Agent4 (con retry) ──
    async setupMcp(retries = 5, delayMs = 2000) {
        for (let i = 1; i <= retries; i++) {
            try {
                this.mcp = new Client({ name: "llm-agent", version: "1.0.0" });
                await this.mcp.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
                const { tools } = await this.mcp.listTools();
                this.mcpToolNames = new Set(tools.map((t) => t.name));
                ALLOWED_STEP_TOOLS = [...new Set([...ALLOWED_STEP_TOOLS, ...this.mcpToolNames])];
                console.log(`🔌 [${this.name}] MCP tools from Agent4: ${[...this.mcpToolNames].join(", ")}`);
                return;
            } catch (e) {
                console.error(`⚠️ [${this.name}] MCP attempt ${i}/${retries} failed: ${e.message}`);
                this.mcp = null;
                if (i < retries) await sleep(delayMs);
            }
        }
        this.mcpToolNames = new Set();
        console.error(`⚠️ [${this.name}] MCP unavailable (${MCP_URL}) — continuing without Agent4.`);
    }

    // ── Esecuzione dei tool (logica di gioco) ────────────────────────────────
    async handleTool(toolName, args) {
        // Delega ai tool MCP di Agent4
        if (this.mcpToolNames.has(toolName)) {
            try {
                const res = await this.mcp.callTool({ name: toolName, arguments: args || {} });
                try { return JSON.parse(res.content?.[0]?.text ?? "{}"); }
                catch { return { raw: res.content }; }
            } catch (e) {
                return { error: `MCP call ${toolName} failed: ${e.message}` };
            }
        }

        switch (toolName) {
            case "move": {
                const ok = await this.socket.emitMove(args.direction);
                return { success: !!ok, position: this.world.me };
            }
            case "go_to": {
                if (!this.world.map) return { error: "Map not loaded yet" };
                const goal = { x: args.x, y: args.y };
                if (!this.world.walkable(goal.x, goal.y)) return { error: `Target (${goal.x},${goal.y}) not walkable` };
                const start = { x: this.world.me.x, y: this.world.me.y };
                const path = astar(this.world, start, goal);
                if (!path) return { error: `No path to (${goal.x},${goal.y})` };
                for (const direction of pathToDirections(path)) {
                    const ok = await this.socket.emitMove(direction);
                    if (!ok) return { error: `Move ${direction} failed en route to (${goal.x},${goal.y})`, position: this.world.me };
                }
                return { success: true, position: { ...this.world.me } };
            }
            case "pickup": {
                const result = await this.socket.emitPickup();
                return { success: true, result };
            }
            case "putdown": {
                const result = await this.socket.emitPutdown();
                return { success: true, result };
            }
            case "calculate": {
                const expr = args.expression ?? "";
                if (!/^[0-9+\-*/().\s]+$/.test(expr)) return { error: "Invalid expression" };
                try {
                    // eslint-disable-next-line no-new-func
                    const result = Function(`"use strict"; return (${expr});`)();
                    return { expression: expr, result };
                } catch (e) {
                    return { error: `Could not evaluate: ${e.message}` };
                }
            }
            case "plan_and_deliver": {
                return await this.executeDeliveryPlan(args || {});
            }
            default:
                return { error: `Unknown tool ${toolName}` };
        }
    }

    async executeDeliveryPlan({ parcelId, deliveryTarget, costPerStep = 1, minWorth = 0 } = {}) {
        if (!this.world.map) return { error: "Map not loaded yet" };

        const allParcels = [...this.world.parcels.values()].filter((p) => !p.carriedBy);
        if (!allParcels.length) return { error: "No parcels currently sensed nearby." };

        const start = { x: this.world.me.x, y: this.world.me.y };

        let targetParcel;
        let toParcel;
        if (parcelId) {
            targetParcel = allParcels.find((p) => String(p.id) === String(parcelId));
            if (!targetParcel) return { error: `Parcel ${parcelId} not found.` };
            const path = astar(this.world, start, { x: targetParcel.x, y: targetParcel.y });
            if (!path) return { error: `Parcel ${parcelId} not reachable.` };
            toParcel = { target: targetParcel, path, steps: path.length - 1 };
        } else {
            toParcel = nearestReachable(this.world, start, allParcels);
            if (!toParcel) return { error: "No reachable parcel found." };
            targetParcel = toParcel.target;
        }

        const deliveryTiles = this.world.map.deliveryTiles || [];
        if (!deliveryTiles.length) return { error: "No delivery tiles on map." };

        let candidateTiles = deliveryTiles;
        if (deliveryTarget && Number.isInteger(deliveryTarget.x) && Number.isInteger(deliveryTarget.y)) {
            const specific = deliveryTiles.find((t) => t.x === deliveryTarget.x && t.y === deliveryTarget.y);
            if (!specific) return { error: `(${deliveryTarget.x},${deliveryTarget.y}) is not a delivery tile.` };
            candidateTiles = [specific];
        }

        const toDelivery = nearestReachable(this.world, { x: targetParcel.x, y: targetParcel.y }, candidateTiles);
        if (!toDelivery) return { error: "No reachable delivery tile." };

        const totalSteps = toParcel.steps + toDelivery.steps;
        const reward = targetParcel.reward ?? targetParcel.value ?? null;
        const travelCost = totalSteps * costPerStep;
        const worth = reward === null ? null : reward - travelCost;

        if (worth !== null && worth < minWorth) {
            return {
                executed: false,
                reason: `Not worth it: reward=${reward}, cost=${travelCost}, worth=${worth} < ${minWorth}.`,
                targetParcel, totalSteps, reward, travelCost, worth,
            };
        }

        const log = [];
        const walk = async (path) => {
            for (const direction of pathToDirections(path)) {
                const ok = await this.socket.emitMove(direction);
                log.push({ move: direction, success: !!ok });
                if (!ok) throw new Error(`Move ${direction} failed`);
            }
        };

        try {
            await walk(toParcel.path);
            await sleep(50);
            const stillHere = [...this.world.parcels.values()].some(
                (p) => String(p.id) === String(targetParcel.id) && !p.carriedBy
            );
            if (!stillHere) throw new Error(`Parcel ${targetParcel.id} no longer available`);
            log.push({ action: "pickup", result: await this.socket.emitPickup() });
            await walk(toDelivery.path);
            log.push({ action: "putdown", result: await this.socket.emitPutdown() });
        } catch (e) {
            return { executed: false, error: e.message, log, targetParcel, totalSteps, reward, travelCost, worth };
        }

        return { executed: true, targetParcel, deliveryTile: toDelivery.target, totalSteps, reward, travelCost, worth, log, finalPosition: { ...this.world.me } };
    }

    // ── Osservazione COMPATTA per non sforare il context ────────────────────
    async buildCompactObservation() {
        const me = this.world.me;
        const freeParcels = this.world.freeParcels()
            .slice(0, 5)
            .map((p) => ({ id: p.id, x: p.x, y: p.y, reward: p.reward ?? p.value ?? null }));
        const carrying = this.world.carrying().map((p) => ({ id: p.id, reward: p.reward ?? p.value ?? null }));

        let nearestDelivery = null;
        let deliveryHints = null;
        const dt = this.world.map?.deliveryTiles || [];
        if (dt.length) {
            const nd = nearestReachable(this.world, { x: me.x, y: me.y }, dt);
            if (nd) nearestDelivery = nd.target;
            deliveryHints = {
                leftmost: dt.reduce((a, b) => (b.x < a.x ? b : a)),
                rightmost: dt.reduce((a, b) => (b.x > a.x ? b : a)),
                topmost: dt.reduce((a, b) => (b.y > a.y ? b : a)),
                bottommost: dt.reduce((a, b) => (b.y < a.y ? b : a)),
                count: dt.length,
            };
        }

        // Stato di Agent4 (se il server MCP lo espone)
        let agent4 = null;
        if (this.mcp && this.mcpToolNames.has("get_agent_state")) {
            try {
                const res = await this.mcp.callTool({ name: "get_agent_state", arguments: {} });
                agent4 = JSON.parse(res.content?.[0]?.text ?? "null");
            } catch { /* Agent4 non raggiungibile: ignora */ }
        }

        return { me: { x: me.x, y: me.y }, carrying, freeParcels, nearestDelivery, deliveryHints, agent4 };
    }

    // ── Planner LLM: retry + fallback JSON dal content ───────────────────────
    async requestPlan(originalGoal, observation, previousError = null) {
        let lastError = null;

        const mcpHelp = this.mcpToolNames.size
            ? `move_agent {direction, n?}, goto_agent {x, y} (walks Agent4 to coordinates with pathfinding), ` +
              `pickup_agent {}, putdown_agent {} control Agent4, a SECOND agent. ` +
              `Use them ONLY when the goal mentions agent4 / the other agent. Agent4 position is in State.agent4.\n`
            : "";

        for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
            const userContent =
                `Goal: ${originalGoal}\n` +
                `State: ${JSON.stringify(observation)}\n` +
                (previousError ? `Previous attempt failed: ${previousError}. Fix it.\n` : "") +
                (lastError ? `Your last plan was invalid: ${lastError}. Fix it.\n` : "") +
                `Call submit_plan once with the final steps.\n` +
                `Tools: move {direction}, go_to {x,y} (walks there with pathfinding), pickup {}, putdown {}, ` +
                `plan_and_deliver {deliveryTarget?} (full pickup+deliver; deliveryTarget {x,y} optional to force a specific delivery tile), ` +
                `calculate {expression} (evaluate math like "4*2").\n` +
                mcpHelp +
                `If coordinates are math expressions, compute them and use the results directly in go_to.\n` +
                `For "leftmost/rightmost/topmost/bottommost tile" use State.deliveryHints coordinates.\n` +
                `To drop a package at a specific tile: go_to that tile then putdown (if already carrying), ` +
                `or plan_and_deliver with deliveryTarget.\n` +
                `If the goal says the result gives NEGATIVE points (e.g. -10pts, lose 10 points), ` +
                `set status "blocked" and explain in reason. Never execute point-losing goals.`;

            try {
                const completion = await client.chat.completions.create({
                    model: this.model,
                    messages: [
                        { role: "system", content: `You are ${this.name}, a Deliveroo planner. You MUST call the submit_plan tool. Never reply with plain text. Max 8 steps.` },
                        { role: "user", content: userContent },
                    ],
                    tools: buildPlanningTools(),
                    tool_choice: "required",
                    temperature: 0.1,
                    max_tokens: 400,
                });

                const msg = completion.choices[0].message;
                const call = msg.tool_calls?.find((c) => c.function.name === "submit_plan");

                if (call) {
                    return JSON.parse(call.function.arguments || "{}");
                }

                if (msg.content) {
                    const jsonMatch = msg.content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        if (parsed.steps || parsed.status) return parsed;
                        if (parsed.arguments) {
                            return typeof parsed.arguments === "string" ? JSON.parse(parsed.arguments) : parsed.arguments;
                        }
                        if (parsed.parameters) return parsed.parameters;
                    }
                }

                lastError = "no submit_plan tool call and no valid JSON in response";
            } catch (error) {
                lastError = error.message;
            }
        }

        throw new Error(`Planner failed after ${MAX_PLAN_ATTEMPTS} attempts: ${lastError}`);
    }

    validateStep(step, originalGoal, liveObservation) {
        const allowed = new Set(ALLOWED_STEP_TOOLS);
        if (!step || !allowed.has(step.tool)) return { valid: false, error: `Tool ${step?.tool} not allowed` };
        if (!step.args || typeof step.args !== "object" || Array.isArray(step.args)) {
            return { valid: false, error: "args must be an object" };
        }
        if (typeof step.expectedPointChange !== "number" || !Number.isFinite(step.expectedPointChange)) {
            return { valid: false, error: "expectedPointChange must be a number" };
        }

        const explicitChange = getExplicitPointChange(originalGoal);
        if (step.expectedPointChange < 0 && (explicitChange === null || explicitChange >= 0)) {
            return { valid: false, error: "Negative point change not explicit in goal" };
        }

        // Tool MCP: lo stato di Agent4 è validato dal server MCP, qui solo forma
        if (this.mcpToolNames.has(step.tool)) {
            if (step.tool === "move_agent" && !["up", "down", "left", "right"].includes(step.args.direction)) {
                return { valid: false, error: "move_agent requires direction up/down/left/right" };
            }
            return { valid: true };
        }

        if (step.tool === "move") {
            if (!["up", "down", "left", "right"].includes(step.args.direction)) {
                return { valid: false, error: "Invalid move direction" };
            }
            const delta = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[step.args.direction];
            const nx = liveObservation.me.x + delta[0];
            const ny = liveObservation.me.y + delta[1];
            if (!this.world.walkable(nx, ny)) return { valid: false, error: `Move enters non-walkable (${nx},${ny})` };
        }
        if (step.tool === "go_to" && (!Number.isInteger(step.args.x) || !Number.isInteger(step.args.y))) {
            return { valid: false, error: "go_to requires integer x,y" };
        }
        if (step.tool === "pickup" && !this.world.parcelHere()) {
            return { valid: false, error: "No free parcel here" };
        }
        if (step.tool === "putdown" && (!this.world.atDelivery() || this.world.carrying().length === 0)) {
            return { valid: false, error: "Putdown requires carried parcel on delivery tile" };
        }

        return { valid: true };
    }

    async executeStepList(mission) {
        for (const step of mission.plan.steps) {
            if (mission.totalStepsExecuted >= MAX_MISSION_STEPS) {
                mission.actionQueue.push({ kind: "aborted", error: "Max mission steps reached" });
                mission.status = "failed";
                return;
            }

            await sleep(30);
            const liveObservation = await this.buildCompactObservation();
            const validation = this.validateStep(step, mission.originalGoal, liveObservation);

            if (!validation.valid) {
                mission.actionQueue.push({ kind: "rejected", tool: step.tool, args: step.args, error: validation.error });
                mission.status = "failed";
                mission.lastError = validation.error;
                return;
            }

            let result, toolError = null;
            try {
                result = await this.handleTool(step.tool, step.args);
                if (result?.error) toolError = result.error;
                if (result?.success === false) toolError = toolError || "success=false";
            } catch (error) {
                toolError = error.message;
                result = { error: error.message };
            }

            mission.actionQueue.push({
                kind: toolError ? "failed" : "executed",
                tool: step.tool,
                args: step.args,
                expectedPointChange: step.expectedPointChange,
                result,
            });
            mission.totalStepsExecuted++;

            if (toolError) {
                mission.status = "failed";
                mission.lastError = toolError;
                return;
            }
        }

        mission.status = "completed";
    }

    async runMission(rawGoal) {
        const originalGoal = preEvalMath(rawGoal);

        const mission = {
            id: randomUUID(),
            originalGoal,
            status: "planning",
            totalStepsExecuted: 0,
            replans: 0,
            actionQueue: [],
            plan: null,
            lastError: null,
        };
        this.currentMission = mission;

        const simple = parseSimpleCommand(originalGoal);
        if (simple) {
            mission.plan = { status: "ready", reason: simple.reason, steps: simple.steps };
            mission.actionQueue.push({ kind: "plan", reason: simple.reason, status: "ready", steps: simple.steps });
            await this.executeStepList(mission);
            if (mission.status === "completed") return simple.reason;
            const last = mission.actionQueue[mission.actionQueue.length - 1];
            return `Missione interrotta al passo "${last?.tool ?? "?"}": ${last?.error || mission.lastError || "errore sconosciuto"}.`;
        }

        let previousError = null;
        while (true) {
            const observation = await this.buildCompactObservation();

            let plan;
            try {
                plan = await this.requestPlan(originalGoal, observation, previousError);
            } catch (error) {
                mission.status = "failed";
                mission.actionQueue.push({ kind: "plan_error", error: error.message });
                return `Missione interrotta: pianificazione non valida (${error.message}).`;
            }

            mission.plan = plan;
            mission.actionQueue.push({ kind: "plan", reason: plan.reason, status: plan.status, steps: plan.steps });

            if (plan.status === "blocked" || !Array.isArray(plan.steps) || !plan.steps.length) {
                mission.status = "blocked";
                return plan.reason || "Missione bloccata: nessun piano valido.";
            }

            await this.executeStepList(mission);

            if (mission.status === "completed") return plan.reason || "Missione completata.";

            if (mission.replans < MAX_REPLANS && mission.totalStepsExecuted < MAX_MISSION_STEPS) {
                mission.replans++;
                mission.status = "planning";
                previousError = mission.lastError || "unknown step failure";
                mission.actionQueue.push({ kind: "replan", error: previousError });
                continue;
            }

            const lastEntry = mission.actionQueue[mission.actionQueue.length - 1];
            return `Missione interrotta al passo "${lastEntry?.tool ?? "?"}": ${lastEntry?.error || mission.lastError || "errore sconosciuto"}.`;
        }
    }

    // ── Classificazione robusta: regex + LLM few-shot ────────────────────────
    async classifyIntent(text) {
        if (parseSimpleCommand(text)) return true;
        if (ACTION_REGEX.test(text)) return true;

        try {
            const classification = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content:
                            "Classify the user message as ACTION (a game command: moving, picking up, delivering parcels, controlling agent4) " +
                            "or TEXT (greetings, questions, small talk). Reply with exactly one word: ACTION or TEXT.\n" +
                            "Examples:\n" +
                            "\"go up 2 tiles\" -> ACTION\n" +
                            "\"raccogli il pacco e consegnalo\" -> ACTION\n" +
                            "\"move to x=4*2 y=(1+3)*3\" -> ACTION\n" +
                            "\"drop a package in the leftmost tile\" -> ACTION\n" +
                            "\"move agent4 right\" -> ACTION\n" +
                            "\"ciao come stai?\" -> TEXT\n" +
                            "\"what can you do?\" -> TEXT",
                    },
                    { role: "user", content: text },
                ],
                temperature: 0,
                max_tokens: 5,
            });
            return classification.choices[0].message.content?.trim().toUpperCase().includes("ACTION");
        } catch {
            return false;
        }
    }

    trimMessages() {
        if (this.messages.length > MAX_CHAT_MESSAGES + 1) {
            this.messages = [this.messages[0], ...this.messages.slice(-(MAX_CHAT_MESSAGES))];
        }
    }

    // ── Core conversazione: testo semplice oppure missione ──────────────────
    async processChat(userText) {
        const text = String(userText ?? "").trim();

        if (this.busy) {
            return "Sono occupato con una missione in corso, riprova tra poco.";
        }
        this.busy = true;

        try {
            this.messages.push({ role: "user", content: text });
            this.trimMessages();

            const pointChange = getExplicitPointChange(text);
            if (pointChange !== null && pointChange < 0) {
                const response = `Operazione scartata: il comando implica una perdita di ${Math.abs(pointChange)} punti.`;
                this.messages.push({ role: "assistant", content: response });
                return response;
            }

            const isAction = await this.classifyIntent(text);

            let response;
            if (isAction) {
                response = await this.runMission(text);
            } else {
                const recent = this.messages.slice(-6).filter((m) => m.role !== "system");
                const completion = await client.chat.completions.create({
                    model: this.model,
                    messages: [this.messages[0], ...recent],
                    temperature: 0.3,
                    max_tokens: 150,
                });
                response = sanitizeChatResponse(completion.choices[0].message.content)
                    || "Non ho capito. Prova con un comando esplicito (es. 'vai su e raccogli il pacco').";
            }

            this.messages.push({ role: "assistant", content: response });
            return response;
        } finally {
            this.busy = false;
        }
    }

    getChatHistory() {
        return this.messages;
    }

    getDebugState() {
        return {
            agent: {
                name: this.name,
                position: this.world.me,
                carrying: this.world.carrying ? this.world.carrying() : [],
            },
            mcp: {
                connected: !!this.mcp,
                tools: [...this.mcpToolNames],
            },
            world: {
                mapLoaded: !!this.world.map,
                mapSize: this.world.map ? { width: this.world.map.width, height: this.world.map.height } : null,
                deliveryTiles: this.world.map?.deliveryTiles ?? [],
                parcels: [...this.world.parcels.values()],
                others: this.world.others,
            },
            mission: this.currentMission
                ? {
                      id: this.currentMission.id,
                      originalGoal: this.currentMission.originalGoal,
                      status: this.currentMission.status,
                      totalStepsExecuted: this.currentMission.totalStepsExecuted,
                      replans: this.currentMission.replans,
                      actionQueue: this.currentMission.actionQueue.slice(-30),
                  }
                : null,
            chatLength: this.messages.length,
        };
    }

    async loop() {
        // Event-driven: risponde a istruzioni HTTP e agli eventi del socket
    }
}

// ── Config loader: legge config.json dalla ROOT del progetto ────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_CONFIG_PATH = path.resolve(PROJECT_ROOT, "config.json");

export async function loadConfig(configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH) {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
}

export function pickAgentConfig(config, { name, type } = {}) {
    const agents = config.agents || [];
    let found;
    if (name) found = agents.find((a) => a.name === name);
    if (!found && type) found = agents.find((a) => a.type === type);
    if (!found) found = agents.find((a) => a.type === "llm_agent");
    return found;
}

export async function startLlmAgentFromConfig(overrides = {}) {
    const config = await loadConfig(overrides.configPath);
    const agentConfig = pickAgentConfig(config, overrides);

    if (!agentConfig) throw new Error("No agent with type 'llm_agent' found in config.json");
    if (!agentConfig.token) throw new Error(`Agent '${agentConfig.name}' in config.json has no token`);

    const agent = new LlmAgent({
        name: agentConfig.name || "LlmBot",
        host: config.host || "http://localhost:8080",
        dashboardUrl: config.dashboardUrl || "http://localhost:3001",
    });

    await agent.setup(agentConfig.token);
    await agent.loop();
    console.log(`✅ [${agent.name}] running. Chat at http://localhost:8090`);
    return agent;
}

// ── Se eseguito direttamente con "node LlmAgent.js" ──────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
    startLlmAgentFromConfig().catch((error) => {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    });
}