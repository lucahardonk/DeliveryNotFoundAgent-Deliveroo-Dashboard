// Load .env before anything reads process.env.
import 'dotenv/config';

import { BtAgent } from './src/agents/bt/BtAgent.js';
import { BdiAgent } from './src/agents/bdi/BdiAgent.js';
import { BaseGreedyAgent } from './src/agents/base_agent/BaseGreedyAgent.js';

/**
 * Entry point.
 *
 * Reads one or more tokens from `.env` and spawns ONE agent per token, all in
 * this single process. Each agent runs its own independent loop (see the agent
 * classes) and reports state to the standalone dashboard over HTTP — the
 * dashboard is launched separately (`npm run dashboard`).
 *
 * Supported .env token formats (use whichever you like):
 *   1) single:            TOKEN=aaa
 *   2) comma-separated:   TOKENS=aaa, bbb, ccc
 *   3) numbered:          TOKEN_1=aaa   TOKEN_2=bbb   ...
 *
 * Agent strategy (all optional, default 'bt'):
 *   AGENT_TYPE=bdi          applies to every agent
 *   AGENT_TYPES=bt,bdi,base one per token, aligned with token order
 *   AGENT_TYPE_1=base       numbered, matches TOKEN_1 / the 1st token
 */

const FACTORIES = { bt: BtAgent, bdi: BdiAgent, base: BaseGreedyAgent };

/** @param {string|undefined} v @returns {string[]} */
function splitList(v) {
    if (!v) return [];
    return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Collect the ordered list of tokens from the environment. */
function collectTokens() {
    const fromList = splitList(process.env.TOKENS);
    if (fromList.length) return fromList;

    const numbered = [];
    for (let i = 1; process.env[`TOKEN_${i}`]; i++) {
        numbered.push(process.env[`TOKEN_${i}`].trim());
    }
    if (numbered.length) return numbered;

    if (process.env.TOKEN && process.env.TOKEN.trim()) return [process.env.TOKEN.trim()];
    return [];
}

/**
 * Resolve the strategy for the token at `index`.
 * Precedence: AGENT_TYPE_<n> > AGENT_TYPES[index] > AGENT_TYPE > 'bt'.
 * @param {number} index @returns {'bt'|'bdi'|'base'}
 */
function resolveType(index) {
    const perIndex = process.env[`AGENT_TYPE_${index + 1}`];
    const list = splitList(process.env.AGENT_TYPES);
    const raw = (perIndex || list[index] || process.env.AGENT_TYPE || 'bt').toLowerCase();
    return FACTORIES[raw] ? raw : 'bt';
}

const host = process.env.HOST;
const dashboardUrl = (process.env.DASHBOARD_URL || 'http://localhost:3001').replace(/\/$/, '');
const tokens = collectTokens();

if (!host) {
    console.error('\n❌ No HOST found. Add HOST="http://localhost:8080/" to your .env file.\n');
    process.exit(1);
}
if (tokens.length === 0) {
    console.error(
        '\n❌ No token found. Add TOKEN, TOKENS or TOKEN_1.. to your .env file.\n' +
        '   Example:\n' +
        '     HOST="http://localhost:8080/"\n' +
        '     TOKENS=aaa, bbb\n',
    );
    process.exit(1);
}

console.log(`\n🎮 Spawning ${tokens.length} agent(s) from .env`);
console.log(`📊 Reporting to dashboard: ${dashboardUrl}\n`);

for (let i = 0; i < tokens.length; i++) {
    const type = resolveType(i);
    const token = tokens[i];
    const label = `${type.toUpperCase()}#${i + 1}`;
    const AgentClass = FACTORIES[type];

    console.log(`🤖 ${label}: type=${type} token=${token.slice(0, 8)}…`);

    const agent = new AgentClass({ token, host, dashboardUrl, label });
    // Don't await — every agent runs its own loop concurrently.
    agent.start().catch((err) => {
        console.error(`❌ ${label} stopped:`, err?.message ?? err);
    });
}

console.log('\n🛑 Press Ctrl+C to stop all agents.\n');

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down all agents…');
    process.exit(0);
});
