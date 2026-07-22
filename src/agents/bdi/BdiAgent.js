import { AgentCore } from '../common/AgentCore.js';
import { bfs } from '../common/grid.js';

const TICK_MS = 200;

/**
 * Belief–Desire–Intention agent.
 *
 * Each deliberation cycle:
 *   1. BELIEFS  — the live world model maintained by {@link AgentCore} (self,
 *      parcels, other agents, map).
 *   2. DESIRES  — candidate goals with a numeric score:
 *        • deliver   (score grows with carried reward + closeness to a drop-off)
 *        • pickup     (parcel reward minus travel distance)
 *        • explore    (constant low baseline so the agent never idles)
 *   3. INTENTION — commit to the highest-scoring desire and keep it until it is
 *      achieved or becomes invalid (parcel gone, unreachable), then reconsider.
 *   4. EXECUTE   — advance the committed intention by one action.
 */
export class BdiAgent extends AgentCore {
    constructor(opts) {
        super({ ...opts, type: 'bdi', label: opts.label ?? 'BDI' });
        /** @type {{goal:string, target?:object, parcelId?:string}|null} */
        this.intention = null;
    }

    async run() {
        for (;;) {
            const desires = this._generateDesires();
            const best = desires[0] ?? { goal: 'explore', score: 0 };

            // Commit / reconsider: switch only when the current intention is no
            // longer valid or a clearly better desire emerges.
            if (!this._intentionStillValid()) {
                this.intention = best;
            }

            const action = await this._execute(this.intention);
            await this.reportState('running', action);
            await this.sleep(TICK_MS);
        }
    }

    // ── Desires ────────────────────────────────────────────────────────────

    /** Builds the scored desire list, highest score first. */
    _generateDesires() {
        const desires = [];

        // Deliver: only meaningful while carrying something.
        const carried = this.carrying();
        if (carried.length > 0) {
            const del = this.nearestDelivery();
            if (del) {
                const reward = carried.reduce((s, p) => s + (p.reward ?? 1), 0);
                desires.push({ goal: 'deliver', target: del.target, score: reward + 10 - del.dist });
            }
        }

        // Pickup: one desire per reachable free parcel, scored by reward minus
        // travel distance (closer, higher-reward parcels win).
        const blocked = this.blockedTiles();
        for (const p of this.freeParcels()) {
            const r = bfs(this.map, this.me, { x: p.x, y: p.y }, blocked);
            if (r) desires.push({ goal: 'pickup', target: { x: p.x, y: p.y }, parcelId: p.id, score: (p.reward ?? 1) - r.dist });
        }

        // Explore: constant low baseline so we never sit idle.
        desires.push({ goal: 'explore', score: 0.1 });

        desires.sort((a, b) => b.score - a.score);
        return desires;
    }

    // ── Intention validity ───────────────────────────────────────────────────

    _intentionStillValid() {
        const it = this.intention;
        if (!it) return false;
        if (it.goal === 'deliver') return this.carrying().length > 0;
        if (it.goal === 'pickup') {
            const p = this.parcels.get(it.parcelId);
            return Boolean(p && !p.carriedBy); // still there and still free
        }
        if (it.goal === 'explore') {
            // abandon exploration as soon as there's something better to do.
            return this.carrying().length === 0 && this.freeParcels().length === 0;
        }
        return false;
    }

    // ── Execute one intention step ─────────────────────────────────────────────

    async _execute(intention) {
        switch (intention?.goal) {
            case 'deliver': {
                if (this.atDelivery()) {
                    await this.putdown();
                    this.intention = null;
                    return 'delivered parcels';
                }
                const del = this.nearestDelivery();
                if (del) {
                    await this.stepToward(del.target);
                    return `deliver → (${del.target.x},${del.target.y})`;
                }
                return 'deliver (no route)';
            }
            case 'pickup': {
                const p = this.parcels.get(intention.parcelId);
                if (!p) { this.intention = null; return 'pickup (parcel gone)'; }
                if (p.x === this.me.x && p.y === this.me.y) {
                    await this.pickup();
                    this.intention = null;
                    return 'picked up parcel';
                }
                await this.stepToward({ x: p.x, y: p.y });
                return `pickup → (${p.x},${p.y})`;
            }
            default:
                await this._explore();
                return 'exploring';
        }
    }

    async _explore() {
        const spawners = this.map?.spawnerTiles ?? [];
        if (spawners.length) {
            const target = spawners[Math.floor(Math.random() * spawners.length)];
            if (await this.stepToward(target)) return;
        }
        const dirs = ['up', 'down', 'left', 'right'];
        await this.client.move(dirs[Math.floor(Math.random() * dirs.length)]);
    }
}
