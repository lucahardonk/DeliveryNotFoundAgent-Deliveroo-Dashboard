import { AgentCore } from '../bdi/AgentCore.js';

const TICK_MS = 200;

/** Behaviour-tree node results. */
const SUCCESS = 'SUCCESS';
const FAILURE = 'FAILURE';

/**
 * Selector: run children in order, return SUCCESS at the first child that
 * succeeds (i.e. handles this tick), else FAILURE.
 */
function selector(...children) {
    return async (bb) => {
        for (const child of children) {
            if ((await child(bb)) === SUCCESS) return SUCCESS;
        }
        return FAILURE;
    };
}

/** Sequence: run children in order, stop and return FAILURE at the first failure. */
function sequence(...children) {
    return async (bb) => {
        for (const child of children) {
            if ((await child(bb)) === FAILURE) return FAILURE;
        }
        return SUCCESS;
    };
}

/**
 * Behaviour-Tree agent.
 *
 * Instead of an ad-hoc if/else chain, decisions are expressed as a small,
 * reusable behaviour tree that is re-ticked every cycle:
 *
 *   Selector
 *   ├── Sequence  [carrying?] → [deliver]
 *   ├── [pickup parcel here]
 *   ├── [go to nearest free parcel]
 *   └── [explore]                (fallback, always succeeds)
 *
 * The tree operates on a "blackboard" (`bb`) which is simply the agent itself.
 */
export class BtAgent extends AgentCore {
    constructor(opts) {
        super({ ...opts, type: 'bt', label: opts.label ?? 'BT' });
        this.lastAction = 'idle';
        this.tree = this._buildTree();
    }

    _buildTree() {
        // ── Leaf behaviours ──────────────────────────────────────────────────
        const deliver = sequence(
            (bb) => (bb.carrying().length > 0 ? SUCCESS : FAILURE),
            async (bb) => {
                if (bb.atDelivery()) {
                    await bb.putdown();
                    bb.lastAction = 'delivered parcels';
                    return SUCCESS;
                }
                const del = bb.nearestDelivery();
                if (!del) return FAILURE;
                await bb.stepToward(del.target);
                bb.lastAction = `to delivery (${del.target.x},${del.target.y})`;
                return SUCCESS;
            },
        );

        const pickupHere = async (bb) => {
            if (!bb.parcelHere()) return FAILURE;
            await bb.pickup();
            bb.lastAction = 'picked up parcel';
            return SUCCESS;
        };

        const goToParcel = async (bb) => {
            const parcel = bb.nearestFreeParcel();
            if (!parcel) return FAILURE;
            await bb.stepToward(parcel.target);
            bb.lastAction = `to parcel (${parcel.target.x},${parcel.target.y})`;
            return SUCCESS;
        };

        const explore = async (bb) => {
            await bb._explore();
            bb.lastAction = 'exploring';
            return SUCCESS;
        };

        return selector(deliver, pickupHere, goToParcel, explore);
    }

    async run() {
        for (;;) {
            await this.tree(this);
            await this.reportState('running', this.lastAction);
            await this.sleep(TICK_MS);
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
