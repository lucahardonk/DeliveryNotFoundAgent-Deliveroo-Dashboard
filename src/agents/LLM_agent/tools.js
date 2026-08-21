// tools.js
// Tool definitions exposed to the LLM, plus their real implementations
// that operate on the agent (move, pickup, putdown).

import { stepToward } from './functions.js';

// ── JSON schemas sent to Ollama so the model knows what tools exist ─────────


// ── Real implementations, dispatched by name ─────────────────────────────────

/**
 * Moves the agent to (x, y), stepping through the A* path one tile at a
 * time until it arrives or a move fails (blocked / no path).
 *
 * @param {object} agent
 * @param {number} x
 * @param {number} y
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function moveTo(agent, x, y) {
    const target = { x, y };

    while (!agent.world.isAt(target)) {
        const moved = await stepToward(agent, target);

        if (!moved) {
            return { success: false, message: `blocked or no path to (${x},${y})` };
        }
    }

    return { success: true, message: `arrived at (${x},${y})` };
}

/**
 * Executes a single tool call against the agent and returns a structured
 * result: { success, message }. This gets serialized back to the LLM.
 *
 * @param {object} agent
 * @param {{ name: string, arguments: object }} call
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function runTool(agent, call) {
    const { name, arguments: args } = call;

    switch (name) {
        case 'move_to':
            return moveTo(agent, args.x, args.y);

        case 'pick_up_parcel': {
            const ok = await agent.io.doPickup();
            return ok
                ? { success: true, message: 'parcel picked up' }
                : { success: false, message: 'no parcel to pick up here' };
        }

        case 'put_down_parcel': {
            const ok = await agent.io.doPutdown();
            return ok
                ? { success: true, message: 'parcel(s) put down' }
                : { success: false, message: 'could not put down here' };
        }

        default:
            return { success: false, message: `unknown tool: ${name}` };
    }
}