import { BaseAgent } from '../common/BaseAgent.js';
import { BtBlackboard } from './BtBlackboard.js';
import { buildTree } from './tree/buildTree.js';

const START_DELAY_MS = 1000;

/**
 * Behaviour-Tree agent.
 *
 * Reactively re-evaluates a fixed behaviour tree every tick (deliver > pick up
 * the closest parcel > explore), maintaining a parcel-sighting heatmap and
 * pushing live snapshots to the dashboard. All belief state and helpers live in
 * {@link BtBlackboard}; the decision logic lives in {@link buildTree}.
 */
export class BehaviourTreeAgent extends BaseAgent {
    /**
     * @param {object} [options]
     * @param {object|null} [options.dashboardClient] - dashboard push client.
     * @param {string} [options.token] - auth token; defaults to `process.env.TOKEN`.
     * @param {string} [options.host] - server URL; defaults to `process.env.HOST`.
     */
    constructor({ dashboardClient = null, token, host } = {}) {
        super({ dashboardClient, trackHeatmap: true, publishToDashboard: true, token, host });

        this.blackboard = new BtBlackboard(this.ctx);
        this.tree = buildTree();
    }

    /** @override — expose the queued moves so snapshots include the current path. */
    _currentPath() {
        return this.blackboard.actions;
    }

    /**
     * Connects, waits for beliefs, then runs the behaviour-tree execution loop.
     * @returns {Promise<void>}
     */
    async start() {
        console.log('Initializing...');
        await this.init();
        console.log('Starting...');

        const { tick } = this.tree;

        const executionLoop = async () => {
            console.log('Execution Loop...');
            while (true) {
                await tick(this.blackboard);
            }
        };

        setTimeout(() => executionLoop(), START_DELAY_MS);
    }
}
