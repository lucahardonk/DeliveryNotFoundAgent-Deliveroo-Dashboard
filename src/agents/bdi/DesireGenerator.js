/**
 * Generates the BDI agent's scored desires each deliberation tick.
 *
 * A desire is a candidate goal (`DELIVER` / `PICKUP` / `EXPLORE`) paired with a
 * utility score derived from domain heuristics. The utility formulas are ported
 * verbatim from the monolithic `BDI_Agent_2` so ranking behaviour is unchanged.
 *
 * @typedef {import("../base_agent/AgentContext.js").AgentContext} AgentContext
 * @typedef {import("./BdiBeliefs.js").BdiBeliefs} BdiBeliefs
 *
 * @typedef {Object} Desire
 * @property {string} goal    - matches a plan's `trigger`.
 * @property {number} utility - score used to rank and select intentions.
 */
export class DesireGenerator {
    /**
     * @param {AgentContext} ctx
     * @param {BdiBeliefs} beliefs
     */
    constructor(ctx, beliefs) {
        this.ctx = ctx;
        this.beliefs = beliefs;
    }

    /**
     * All currently achievable desires, sorted descending by utility.
     * @returns {Desire[]}
     */
    generateDesires() {
        const desires = [];

        if (this.beliefs.hasParcel()) {
            desires.push({ goal: 'DELIVER', utility: this.#deliveryUtility() });
        }

        if (this.ctx.perception.sensedParcels.length > 0) {
            desires.push({ goal: 'PICKUP', utility: this.#pickupUtility() });
        }

        desires.push({ goal: 'EXPLORE', utility: this.#exploreUtility() });

        return desires.sort((a, b) => b.utility - a.utility);
    }

    // ── Utility functions (desire scoring) ─────────────────────────────────

    #deliveryUtility() {
        const me = this.ctx.me;
        const carriedParcels = this.ctx.perception.sensedParcels.filter(p => p.carriedBy === me.id);

        const totalValue = carriedParcels.reduce((sum, p) => sum + (p.reward ?? 1), 0);
        const deliveryTiles = this.ctx.map.deliveryTiles;
        const avgDeliveryDist = deliveryTiles.length > 0
            ? Math.min(...deliveryTiles.map(t => Math.abs(t.x - me.x) + Math.abs(t.y - me.y)))
            : 999;

        return totalValue * 10 - avgDeliveryDist * 0.5;
    }

    #pickupUtility() {
        const me = this.ctx.me;
        const uncollected = this.ctx.perception.sensedParcels.filter(p => p.carriedBy === null);
        if (uncollected.length === 0) return 0;

        const closest = uncollected.reduce((best, p) => {
            const d = Math.abs(p.x - me.x) + Math.abs(p.y - me.y);
            return d < best.dist ? { dist: d, parcel: p } : best;
        }, { dist: Infinity, parcel: null });

        const decayRate = this.ctx.config.parcelDecayInterval ?? 1000;
        const timeBonus = closest.parcel?.reward ?? 1;

        return timeBonus * 5 - closest.dist * 0.3 - (decayRate < 2000 ? 2 : 0);
    }

    #exploreUtility() {
        const timeSinceLastParcel = this.ctx.perception.sensedParcels.length === 0
            ? this.ctx.elapsedTime
            : 0;

        return 1 + Math.min(timeSinceLastParcel * 0.001, 3);
    }
}
