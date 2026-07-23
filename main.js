import fs from 'node:fs/promises';
import { GreedyAgent } from './src/agents/base_agent/GreedyAgent.js';
import { BtAgent }     from './src/agents/bt/BtAgent.js';
import { BdiAgent } from './src/agents/bdi/BdiAgent.js';

// ── Registry ──────────────────────────────────────────────────────────────────
// Add new agent types here as you build them.

const REGISTRY = {
    base_agent: GreedyAgent,
    bt_agent:   BtAgent,
    bdi_agent:  BdiAgent,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// ── Config ────────────────────────────────────────────────────────────────────

const config = JSON.parse(await fs.readFile('config.json', 'utf8'));

if (!config.host)          throw new Error('Missing "host" in config.json');
if (!config.agents?.length) throw new Error('No agents in config.json');

// Only agents with "enabled": true (or no "enabled" field at all) are started.
const activeAgents = config.agents.filter((a) => a.enabled !== false);

if (!activeAgents.length) throw new Error('No enabled agents in config.json');

console.log(`▶  Starting ${activeAgents.length} agent(s): ${activeAgents.map((a) => a.name).join(', ')}\n`);

// ── Setup ─────────────────────────────────────────────────────────────────────
// Sequential: if any agent fails to connect, the whole process stops.

const agents = [];

for (const agentConfig of activeAgents) {
    const AgentClass = REGISTRY[agentConfig.type];

    if (!AgentClass) {
        throw new Error(
            `Unknown agent type "${agentConfig.type}". ` +
            `Available: ${Object.keys(REGISTRY).join(', ')}`,
        );
    }

    const agent = new AgentClass({
        name:         agentConfig.name,
        host:         config.host,
        dashboardUrl: config.dashboardUrl,
    });

    await agent.setup(agentConfig.token);   // throws → stops everything

    agents.push(agent);
}

// ── Loop ──────────────────────────────────────────────────────────────────────
// All active agents tick in parallel every tickMs.
// A loop error in one agent is logged but does NOT crash the others.

console.log('🔁 All agents running. Press Ctrl+C to stop.\n');

for (;;) {
    await Promise.all(
        agents.map((agent) =>
            agent.loop().catch((err) =>
                console.error(`❌ [${agent.name}] loop error:`, err?.message ?? err),
            ),
        ),
    );

    await sleep(config.tickMs ?? 200);
}