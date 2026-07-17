import dashboardClient from '../core/dashboard/DashboardClient.js';
import { BehaviourTreeAgent } from '../agents/bt/BehaviourTreeAgent.js';
import { BdiAgent } from '../agents/bdi/BdiAgent.js';

/**
 * @typedef {'bt'|'bdi'} AgentType
 */

/**
 * Factory that wires up a concrete agent by strategy name.
 *
 * This is the single place where a strategy is chosen and its dependencies
 * (e.g. the dashboard client for the behaviour-tree agent) are injected,
 * replacing the commented-out `new X_Agent()` swapping in the original
 * `src/main.js`.
 *
 * @param {AgentType} [type='bt'] - which strategy to instantiate.
 * @returns {import("../agents/common/BaseAgent.js").BaseAgent}
 */
export function createAgent(type = 'bt') {
    switch (type) {
        case 'bt':
            return new BehaviourTreeAgent({ dashboardClient });
        case 'bdi':
            return new BdiAgent();
        default:
            throw new Error(`Unknown agent type: '${type}'. Expected 'bt' or 'bdi'.`);
    }
}
