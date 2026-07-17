// Load .env before anything reads process.env.
import 'dotenv/config';

// Starting the dashboard server (side-effect import) — serves the live UI and
// exposes the ingestion endpoint the agents push snapshots to.
import '../core/dashboard/DashboardServer.js';

import { createAgent } from './createAgent.js';

/**
 * Entry point.
 *
 * Reads one or more tokens from the environment and spawns one agent per token,
 * all sharing the same process and the same live dashboard. This lets you run
 * as many agents as you like just by editing `.env` — no code changes needed.
 *
 * Supported .env formats (pick whichever you prefer):
 *
 *   # 1) A single token (classic):
 *   HOST="http://localhost:8080/"
 *   TOKEN=eyJ...
 *
 *   # 2) Many tokens, comma- or whitespace-separated:
 *   HOST="http://localhost:8080/"
 *   TOKENS=eyJ...aaa, eyJ...bbb, eyJ...ccc
 *
 *   # 3) Many tokens, numbered:
 *   TOKEN_1=eyJ...aaa
 *   TOKEN_2=eyJ...bbb
 *
 * Agent strategy per token (all optional, default 'bt'):
 *   AGENT_TYPE=bdi            # applies to every agent
 *   AGENT_TYPES=bt,bdi,bt     # one per token, aligned with the token order
 *   AGENT_TYPE_1=bt           # numbered, matches TOKEN_1 / the 1st token
 */

/** @param {string|undefined} v @returns {string[]} */
function splitList(v) {
    if (!v) return [];
    return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Collect the ordered list of tokens from the environment. */
function collectTokens() {
    // 2) TOKENS=a,b,c
    const fromList = splitList(process.env.TOKENS);
    if (fromList.length) return fromList;

    // 3) TOKEN_1, TOKEN_2, ... (contiguous from 1)
    const numbered = [];
    for (let i = 1; process.env[`TOKEN_${i}`]; i++) {
        numbered.push(process.env[`TOKEN_${i}`].trim());
    }
    if (numbered.length) return numbered;

    // 1) single TOKEN
    if (process.env.TOKEN && process.env.TOKEN.trim()) return [process.env.TOKEN.trim()];

    return [];
}

/**
 * Resolve the agent strategy for the token at `index`.
 * Precedence: AGENT_TYPE_<n>  >  AGENT_TYPES[index]  >  AGENT_TYPE  >  'bt'.
 * @param {number} index @returns {'bt'|'bdi'}
 */
function resolveType(index) {
    const perIndex = process.env[`AGENT_TYPE_${index + 1}`];
    const list = splitList(process.env.AGENT_TYPES);
    const raw = (perIndex || list[index] || process.env.AGENT_TYPE || 'bt').toLowerCase();
    return raw === 'bdi' ? 'bdi' : 'bt';
}

const host = process.env.HOST;
const tokens = collectTokens();

if (tokens.length === 0) {
    console.error(
        '\n❌ No token found. Add TOKEN, TOKENS or TOKEN_1.. to your .env file.\n' +
        '   Example:\n' +
        '     HOST="http://localhost:8080/"\n' +
        '     TOKENS=eyJ...aaa, eyJ...bbb\n'
    );
    process.exit(1);
}

console.log(`\n🎮 Spawning ${tokens.length} agent(s) from .env\n`);

const agents = [];
for (let i = 0; i < tokens.length; i++) {
    const type = resolveType(i);
    const token = tokens[i];
    console.log(`🤖 Agent #${i + 1}: type=${type.toUpperCase()} token=${token.substring(0, 12)}…${token.substring(token.length - 6)}`);
    const agent = createAgent(type, { token, host });
    agents.push(agent);
    // start() runs each agent's own loop; don't await here so all agents run concurrently.
    agent.start().catch((err) => {
        console.error(`❌ Agent #${i + 1} (${type}) stopped:`, err?.message ?? err);
    });
}

console.log(`\n📊 Dashboard: http://localhost:3001`);
console.log(`🛑 Press Ctrl+C to stop all agents.\n`);

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down all agents…');
    process.exit(0);
});
