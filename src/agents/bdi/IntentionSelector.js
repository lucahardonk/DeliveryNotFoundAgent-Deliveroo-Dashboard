/**
 * The BDI plan library + plan-selection logic.
 *
 * Holds the static Plan Library and a dynamic-plan registry, and selects the
 * highest-priority applicable plan for a given desire. Dynamic plans are
 * checked before static ones (they can override at runtime) and are
 * garbage-collected when they expire.
 *
 * Ported from the `#planLibrary` / `#dynamicPlans` machinery of the monolithic
 * `BDI_Agent_2`.
 *
 * @typedef {import("./DesireGenerator.js").Desire} Desire
 *
 * @typedef {Object} Plan
 * @property {string} id
 * @property {string} trigger
 * @property {number} priority
 * @property {() => boolean} context
 * @property {() => Promise<void>} body
 * @property {'static'|'dynamic'} source
 * @property {number|null} [expiresAt]
 */
export class IntentionSelector {
    /** @type {Map<string, Plan>} */
    #planLibrary = new Map();
    /** @type {Map<string, Plan>} */
    #dynamicPlans = new Map();

    /**
     * Registers (or replaces) a static plan by id.
     * @param {Plan} plan
     */
    registerPlan(plan) {
        this.#planLibrary.set(plan.id, plan);
    }

    /**
     * Injects an ad-hoc dynamic plan at runtime. Dynamic plans are checked
     * before static plans, and may carry an `expiresAt` for auto-removal.
     * @param {Plan} plan
     */
    injectDynamicPlan(plan) {
        if (plan.source !== 'dynamic') {
            console.warn(`[PlanLibrary] injectDynamicPlan called with source='${plan.source}'. Forcing 'dynamic'.`);
            plan.source = 'dynamic';
        }
        this.#dynamicPlans.set(plan.id, plan);
        console.log(`[PlanLibrary] Dynamic plan injected: '${plan.id}' for trigger '${plan.trigger}'`);
    }

    /**
     * Removes a dynamic plan by id. Idempotent.
     * @param {string} planId
     */
    removeDynamicPlan(planId) {
        this.#dynamicPlans.delete(planId);
        console.log(`[PlanLibrary] Dynamic plan removed: '${planId}'`);
    }

    /** Garbage-collects expired dynamic plans. Call at the start of each tick. */
    expireDynamicPlans() {
        const now = Date.now();
        for (const [id, plan] of this.#dynamicPlans) {
            if (plan.expiresAt !== null && plan.expiresAt !== undefined && now > plan.expiresAt) {
                console.log(`[PlanLibrary] Dynamic plan expired and removed: '${id}'`);
                this.#dynamicPlans.delete(id);
            }
        }
    }

    /**
     * For each ranked desire, returns the first (desire, plan) pair that is
     * fully applicable, or null if none applies.
     * @param {Desire[]} desires - desires already sorted descending by utility.
     * @returns {{ desire: Desire, plan: Plan } | null}
     */
    selectIntention(desires) {
        for (const desire of desires) {
            const plan = this.selectPlan(desire.goal);
            if (plan) return { desire, plan };
        }
        return null;
    }

    /**
     * Highest-priority applicable plan for `trigger`, or null.
     * Dynamic plans are merged in first, so they win ties.
     * @param {string} trigger
     * @returns {Plan | null}
     */
    selectPlan(trigger) {
        const candidates = [
            ...this.#dynamicPlans.values(),
            ...this.#planLibrary.values(),
        ].filter(p => p.trigger === trigger && p.context());

        if (candidates.length === 0) return null;

        return candidates.reduce((best, p) => p.priority > best.priority ? p : best);
    }
}
