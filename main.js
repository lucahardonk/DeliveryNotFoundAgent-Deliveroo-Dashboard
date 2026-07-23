import fs from 'node:fs/promises';
import { GreedyAgent } from './src/agents/base_agent/GreedyAgent.js';

const REGISTRY = {
    base_agent: GreedyAgent,
    // Add new agent types here as you build them:
    // bt: BtAgent,
    // bdi: BdiAgent,
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const config = JSON.parse(await fs.readFile('config.json', 'utf8'));

if (!config.host) throw new Error('Missing "host" in config.json');
if (!config.agents?.length) throw new Error('No agents in config.json');

// ── SETUP ────────────────────────────────────────────────────────────────────

const agents = [];

for (const agentConfig of config.agents) {
    const AgentClass = REGISTRY[agentConfig.type];

    if (!AgentClass) {
        throw new Error(
            `Unknown agent type "${agentConfig.type}". ` +
            `Available: ${Object.keys(REGISTRY).join(', ')}`,
        );
    }

    const agent = new AgentClass({
        name: agentConfig.name,
        host: config.host,
        dashboardUrl: config.dashboardUrl,
    });

    await agent.setup(agentConfig.token);

    agents.push(agent);
}

// ── LOOP ─────────────────────────────────────────────────────────────────────

console.log('\n🔁 All agents running. Press Ctrl+C to stop.\n');

for (;;) {
    await Promise.all(
        agents.map((agent) =>  
            agent.loop().catch((err) =>  
                console.error(`❌ [${agent.name}] loop error:`, err?.message ?? err),  
            ),  
        ),
    );

    await sleep(config.tickMs ?? 50);
}