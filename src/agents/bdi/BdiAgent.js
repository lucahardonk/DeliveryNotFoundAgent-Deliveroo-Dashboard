import { BaseAgent } from '../common/BaseAgent.js';
import { BdiBeliefs } from './BdiBeliefs.js';
import { IntentionQueue } from './IntentionQueue.js';
import { DesireGenerator } from './DesireGenerator.js';
import { IntentionSelector } from './IntentionSelector.js';
import { createDeliverPlans } from './plans/DeliverParcelPlan.js';
import { createPickupPlans } from './plans/PickupParcelPlan.js';
import { createExplorePlans } from './plans/GoToTilePlan.js';

const START_DELAY_MS = 1000;

/**
 * The bundle of collaborators passed to every plan `context()` / `body()`.
 * Plans read the world through this instead of reaching into agent internals.
 *
 * @typedef {Object} BdiFacade
 * @property {import("../common/AgentContext.js").AgentContext} ctx
 * @property {BdiBeliefs} beliefs
 * @property {IntentionQueue} queue
 * @property {import("../../core/api/DeliverooClient.js").DeliverooClient} client
 */

/**
 * Belief–Desire–Intention agent.
 *
 * This is the decomposed successor of the monolithic `BDI_Agent_2`: the shared
 * connection/belief plumbing lives in {@link BaseAgent}, beliefs / desires /
 * plan-selection live in their own modules, and the plan library is assembled
 * from the `plans/` folder. The deliberation loop here is unchanged in
 * behaviour — expire dynamic plans, pick the best applicable intention, clear
 * the queue on an intention switch, then run one plan tick.
 */
export class BdiAgent extends BaseAgent {
    /** @param {object} [options] - forwarded to {@link BaseAgent}. */
    constructor(options = {}) {
        super({ ...options, waitForInfo: true });

        /** The intention as an executable move queue. */
        this.queue = new IntentionQueue(this.ctx);
        /** Belief predicate helpers. */
        this.beliefs = new BdiBeliefs(this.ctx, this.queue);
        /** Scored-desire generator. */
        this.desires = new DesireGenerator(this.ctx, this.beliefs);
        /** Plan library + selection. */
        this.selector = new IntentionSelector();

        /** @type {BdiFacade} */
        this.facade = {
            ctx: this.ctx,
            beliefs: this.beliefs,
            queue: this.queue,
            client: this.client,
        };

        /** @type {string|null} the currently committed goal, or null if idle. */
        this.currentIntention = null;
    }

    /**
     * Assembles the static plan library. Must run after {@link BaseAgent#init}
     * so plan closures see fully-initialised beliefs.
     */
    #buildPlanLibrary() {
        const plans = [
            ...createDeliverPlans(this.facade),
            ...createPickupPlans(this.facade),
            ...createExplorePlans(this.facade),
        ];
        for (const plan of plans) {
            this.selector.registerPlan(plan);
        }
    }

    /** Injects an ad-hoc dynamic plan at runtime. @param {object} plan */
    injectDynamicPlan(plan) {
        this.selector.injectDynamicPlan(plan);
    }

    /** Removes a dynamic plan by id. @param {string} planId */
    removeDynamicPlan(planId) {
        this.selector.removeDynamicPlan(planId);
    }

    /** @returns {import("../../core/navigation/Path.js").TileMoveTile[]} */
    _currentPath() {
        return this.queue.actions;
    }

    async start() {
        console.log('Initializing...');
        await this.init();

        this.#buildPlanLibrary();
        console.log('Plan Library ready. Agent initialized.');
        console.log('Starting BDI deliberation loop...');

        const deliberationLoop = async () => {
            while (true) {
                // 1. Expire any timed-out dynamic plans
                this.selector.expireDynamicPlans();

                // 2. Select the best applicable intention for this tick
                const selected = this.selector.selectIntention(this.desires.generateDesires());

                if (!selected) {
                    console.warn('[BDI] No applicable plan found. Waiting...');
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                }

                const { desire, plan } = selected;

                // 3. Detect intention change — clear navigation state on switch
                if (desire.goal !== this.currentIntention) {
                    console.log(`[BDI] Intention switch: ${this.currentIntention} → ${desire.goal} (plan: ${plan.id})`);
                    this.queue.clear();
                    this.currentIntention = desire.goal;
                }

                // 4. Execute one tick of the selected plan body
                await plan.body();
            }
        };

        setTimeout(deliberationLoop, START_DELAY_MS);
    }
}
