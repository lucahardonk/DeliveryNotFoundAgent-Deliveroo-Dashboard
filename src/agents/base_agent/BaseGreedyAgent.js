import { AgentCore } from '../common/AgentCore.js';

const TICK_MS = 200;

/**
 * Base / greedy agent — the simplest baseline strategy.
 *
 * No planning, no scoring: it just reacts to the world with a fixed, greedy
 * priority every tick:
 *   1. carrying something and standing on a delivery tile  -> put it down;
 *   2. carrying something                                  -> walk to nearest delivery;
 *   3. a free parcel on my tile                            -> pick it up;
 *   4. a reachable free parcel somewhere                   -> walk to the nearest one;
 *   5. nothing to do                                       -> explore (wander).
 *
 * Useful as a performance baseline to compare the BT and BDI agents against.
 */
export class BaseGreedyAgent extends AgentCore {
    constructor(opts) {
        super({ ...opts, type: 'base', label: opts.label ?? 'BASE' });
    }

    async run() {
        for (;;) {
            const action = await this._tick();
            await this.reportState('running', action);
            await this.sleep(TICK_MS);
        }
    }

    /** One greedy decision. @returns {Promise<string>} action description */
    async _tick() {
        // 1 + 2: deliver what we carry.
        if (this.carrying().length > 0) {
            if (this.atDelivery()) {
                await this.putdown();
                return 'delivered parcels';
            }
            const del = this.nearestDelivery();
            if (del) {
                await this.stepToward(del.target);
                return `to delivery (${del.target.x},${del.target.y})`;
            }
        }

        // 3: pick up a parcel we're standing on.
        if (this.parcelHere()) {
            await this.pickup();
            return 'picked up parcel';
        }

        // 4: head to the nearest free parcel.
        const parcel = this.nearestFreeParcel();
        if (parcel) {
            await this.stepToward(parcel.target);
            return `to parcel (${parcel.target.x},${parcel.target.y})`;
        }

        // 5: explore.
        await this._explore();
        return 'exploring';
    }

    /** Wander toward a random spawner tile (or a random walkable step). */
    async _explore() {
        const spawners = this.map?.spawnerTiles ?? [];
        if (spawners.length) {
            const target = spawners[Math.floor(Math.random() * spawners.length)];
            const moved = await this.stepToward(target);
            if (moved) return;
        }
        const dirs = ['up', 'down', 'left', 'right'];
        await this.client.move(dirs[Math.floor(Math.random() * dirs.length)]);
    }
}
