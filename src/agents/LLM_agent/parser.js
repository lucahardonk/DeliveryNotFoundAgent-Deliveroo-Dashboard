// parser.js
// Executes a JSON plan (array of steps: tool | if | loop) step by step on the agent.

import { TOOL_FNS, evaluateCondition, AGENT4_CONDITIONS, agent_get_state } from './tools.js';
import { log } from './functions.js';

const MAX_LOOP_ITERATIONS = 50; // safety limit to avoid infinite loops from a bad plan
const MAX_CONSECUTIVE_FAILURES = 5; // abort loop early if the environment is unresponsive

// ── Detect fatal/connection errors (vs. normal "no parcel here" failures) ───

function isFatalError(result) {
    return !result.success && /MCP error|fetch failed|ECONNREFUSED/i.test(result.message ?? '');
}

// ── Refresh agent4 state if any condition in the list needs it ──────────────

async function refreshAgent4StateIfNeeded(agent, conditions = []) {
    if (conditions.some((c) => AGENT4_CONDITIONS.has(c.condition))) {
        await agent_get_state(agent);
    }
}

// ── Evaluate a list of conditions (AND semantics, as in your examples) ──────

function evaluateConditions(agent, conditions = []) {
    return conditions.every((cond) => evaluateCondition(agent, cond));
}

// ── Execute a single tool step ───────────────────────────────────────────────

async function executeTool(agent, step, depth) {
    const indent = '  '.repeat(depth);
    const fn = TOOL_FNS[step.tool];
    if (!fn) {
        const msg = `unknown tool: ${step.tool}`;
        log(agent.name, 'parser', `${indent}❌ ${msg}`);
        return { success: false, message: msg };
    }

    log(agent.name, 'parser', `${indent}→ ${step.tool}(${JSON.stringify(step.args ?? {})})`);
    const result = await fn(agent, step.args ?? {});
    log(agent.name, 'parser', `${indent}${result.success ? '✅' : '⚠️'} ${step.tool}: ${result.message}`);
    return result;
}

// ── Execute one step (dispatch by step shape) ────────────────────────────────

async function executeStep(agent, step, depth) {
    const indent = '  '.repeat(depth);

    if (step.tool) {
        return executeTool(agent, step, depth);
    }

    if (step.if) {
        await refreshAgent4StateIfNeeded(agent, step.if);
        const condMet = evaluateConditions(agent, step.if);
        log(agent.name, 'parser', `${indent}if(${JSON.stringify(step.if)}) → ${condMet}`);
        const branch = condMet ? step.then : step.else;
        return executePlan(agent, branch ?? [], depth + 1);
    }

    if (step.loop) {
        const { while: whileConds = [], do: doSteps = [] } = step.loop;
        let iterations = 0;
        let consecutiveFailures = 0;
        const results = [];

        while (true) {
            await refreshAgent4StateIfNeeded(agent, whileConds);
            if (!evaluateConditions(agent, whileConds)) break;

            if (iterations >= MAX_LOOP_ITERATIONS) {
                const msg = `loop aborted: exceeded ${MAX_LOOP_ITERATIONS} iterations (possible infinite loop)`;
                log(agent.name, 'parser', `${indent}⛔ ${msg}`);
                results.push({ success: false, message: msg });
                break;
            }

            log(agent.name, 'parser', `${indent}loop iteration ${iterations + 1} (while ${JSON.stringify(whileConds)})`);
            const iterResult = await executePlan(agent, doSteps, depth + 1);
            results.push(...iterResult);

            if (iterResult.some(isFatalError)) {
                const msg = 'loop aborted: fatal/connection error detected';
                log(agent.name, 'parser', `${indent}⛔ ${msg}`);
                results.push({ success: false, message: msg });
                break;
            }

            if (iterResult.every((r) => !r.success)) {
                consecutiveFailures++;
            } else {
                consecutiveFailures = 0;
            }

            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                const msg = `loop aborted: ${MAX_CONSECUTIVE_FAILURES} consecutive failed iterations`;
                log(agent.name, 'parser', `${indent}⛔ ${msg}`);
                results.push({ success: false, message: msg });
                break;
            }

            iterations++;
        }

        return results;
    }

    const msg = `malformed plan step: ${JSON.stringify(step)}`;
    log(agent.name, 'parser', `${indent}❌ ${msg}`);
    return { success: false, message: msg };
}

// ── Execute a full plan (array of steps), flattening results ────────────────

export async function executePlan(agent, plan = [], depth = 0) {
    const allResults = [];
    for (const step of plan) {
        const result = await executeStep(agent, step, depth);
        const flat = Array.isArray(result) ? result : [result];
        allResults.push(...flat);

        if (flat.some(isFatalError)) {
            const indent = '  '.repeat(depth);
            log(agent.name, 'parser', `${indent}⛔ plan aborted: fatal/connection error, stopping remaining steps`);
            break;
        }
    }
    return allResults;
}

// ── Entry point: takes the full LLM JSON { plan, chat } ──────────────────────

export async function runPlan(agent, response) {
    const { plan = [], chat = '' } = response;

    if (chat) {
        log(agent.name, 'parser', `💬 ${chat}`);
        if (typeof agent.sendReply === 'function') {
            agent.sendReply(chat);
        }
    }

    if (!Array.isArray(plan) || plan.length === 0) {
        log(agent.name, 'parser', 'empty or missing plan, nothing to execute');
        return { chat, results: [] };
    }

    const results = await executePlan(agent, plan);
    const failed = results.filter((r) => !r.success);
    if (failed.length) {
        log(agent.name, 'parser', `plan completed with ${failed.length} failed step(s)`);
    } else {
        log(agent.name, 'parser', 'plan completed successfully');
    }

    return { chat, results };
}