import fs from 'node:fs/promises';
import { GreedyAgent }     from './src/agents/base_agent/GreedyAgent.js';
import { BtAgent }         from './src/agents/bt/BtAgent.js';
import { BdiAgent }        from './src/agents/bdi/BdiAgent.js';
import { BdiLlmTestAgent } from './src/agents/bdi_llm_test/BdiLlmTestAgent.js';
import { LlmAgent }        from './src/agents/LLM_agent/LlmAgent.js';

const REGISTRY = {
    base_agent:    GreedyAgent,
    bt_agent:      BtAgent,
    bdi_agent:     BdiAgent,
    bdi_llm_test:  BdiLlmTestAgent,
    llm_agent:     LlmAgent,
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
// Each agent runs its own independent loop instead of a shared Promise.all
// round — otherwise every agent's next decision waits for the slowest
// agent's current action to finish, even when it had nothing to do.
//
// `io.move/pickup/putdown` already resolve only once the server confirms the
// action completed (real movement_duration, not just an ack), so a tick that
// did real work already took real time. tickMs is therefore just a floor: we
// only sleep the leftover time, instead of always sleeping the full amount
// on top of a wait that already happened. That leftover-only sleep still
// protects against a tight spin in the rare tick that does no server I/O at
// all (e.g. every leaf failing synchronously with no reachable target).
// A loop error in one agent is logged but does NOT crash the others.

console.log('🔁 All agents running. Press Ctrl+C to stop.\n');

const tickMs = config.tickMs ?? 200;

async function runAgentLoop(agent) {
    for (;;) {
        const startedAt = Date.now();
        try {
            await agent.loop();
        } catch (err) {
            console.error(`❌ [${agent.name}] loop error:`, err?.message ?? err);
        }
        const remaining = tickMs - (Date.now() - startedAt);
        if (remaining > 0) await sleep(remaining);
    }
}

agents.forEach(runAgentLoop);