// ─────────────────────────────────────────────────────────────────────────────
// Behaviour Tree for the parcel-collection strategy — object-based composition
// of the generic nodes in BehaviourTree.js. `ctx` is the owning BtAgent
// instance (exposes .world, .io, ._stepToward, .lastAction).
//
//   SELECTOR
//   ├── SEQUENCE: carrying ∧ atDelivery    → putdown
//   ├── SEQUENCE: parcelHere ∧ hasCapacity  → pickup (fires even mid-delivery, if there's room)
//   ├── SEQUENCE: carrying
//   │     └── SELECTOR: detour worth it?    → stepToward(candidate parcel)
//   │                    else               → stepToward(nearestDelivery)
//   ├── SEQUENCE: freeParcels exist          → stepToward(nearestParcel)
//   └── explore: nearest spawner tile, excluding the one you're on (always succeeds)
// ─────────────────────────────────────────────────────────────────────────────

import { Status, Selector, Sequence, Condition, Action } from './BehaviourTree.js';
import { nearestReachable } from './Pathfinding.js';

// ── Config helpers ───────────────────────────────────────────────────────────
// Read from world.config (the server's 'config' event), never hardcoded —
// these values are game-instance specific.

/** @param {import('./BtAgent.js').BtAgent} ctx */
function decayIntervalMs(ctx) {
    const raw = ctx.world.config?.GAME?.parcels?.decaying_event ?? '1s';
    const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(raw);
    return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : 1000;
}

/** @param {import('./BtAgent.js').BtAgent} ctx */
function movementMs(ctx) {
    return ctx.world.config?.GAME?.player?.movement_duration ?? 50;
}

/** @param {import('./BtAgent.js').BtAgent} ctx */
function getCapacity(ctx) {
    return ctx.world.config?.GAME?.player?.capacity ?? Infinity;
}

/**
 * Reward each parcel is expected to still have after `travelMs` of further decay.
 * @param {{reward:number}[]} parcels
 * @param {number} travelMs
 * @param {number} decayMs
 */
function valueAtArrival(parcels, travelMs, decayMs) {
    const ticks = Math.floor(travelMs / decayMs);
    return parcels.reduce((/** @type {number} */ sum, p) => sum + Math.max(0, p.reward - ticks), 0);
}

// ── Conditions ───────────────────────────────────────────────────────────────

const isCarrying     = new Condition((ctx) => ctx.world.carrying().length > 0);
const isAtDelivery    = new Condition((ctx) => ctx.world.atDelivery());
const isParcelHere    = new Condition((ctx) => Boolean(ctx.world.parcelHere()));
const hasCapacity     = new Condition((ctx) => ctx.world.carrying().length < getCapacity(ctx));
const hasFreeParcels  = new Condition((ctx) => ctx.world.freeParcels().length > 0);

// ── Actions ──────────────────────────────────────────────────────────────────
// Once a branch's guard has matched it "owns" the tick, so its action always
// resolves to SUCCESS — mirroring the original code's unconditional `return`
// inside each `if`. Only the free-parcel search and the detour evaluation are
// allowed to FAIL, so the selector can fall through to the next branch.

const putdown = new Action(async (ctx) => {
    const ok = await ctx.io.putdown();
    ctx.lastAction = ok ? 'putdown at delivery' : 'putdown failed';
    return Status.SUCCESS;
});

const pickup = new Action(async (ctx) => {
    const here = ctx.world.parcelHere();
    const ok = await ctx.io.pickup();
    ctx.lastAction = ok ? `picked up ${here.id}` : `pickup failed ${here.id}`;
    return Status.SUCCESS;
});

const goToNearestDelivery = new Action(async (ctx) => {
    const del = nearestReachable(ctx.world.map, ctx.world.me, ctx.world.map.deliveryTiles, ctx.world.blockedTiles());
    if (del) {
        await ctx._stepToward(del.target);
        ctx.lastAction = `deliver → (${del.target.x},${del.target.y}) dist=${del.dist}`;
    } else {
        ctx.lastAction = 'deliver (no route)';
    }
    return Status.SUCCESS;
});

const goToNearestParcel = new Action(async (ctx) => {
    const nearest = nearestReachable(ctx.world.map, ctx.world.me, ctx.world.freeParcels(), ctx.world.blockedTiles());
    if (!nearest) return Status.FAILURE;
    await ctx._stepToward(nearest.target);
    ctx.lastAction = `→ parcel (${nearest.target.x},${nearest.target.y}) dist=${nearest.dist}`;
    return Status.SUCCESS;
});

// Compares "deliver now" vs "detour to grab the nearest free parcel, then deliver",
// both valued at arrival time (reward decays 1/tick while travelling — see
// decayIntervalMs). Decay keeps running on parcels already being carried, not
// just ones on the ground, so both scenarios apply it uniformly.
const considerDetour = new Action(async (ctx) => {
    if (!hasCapacityFor(ctx)) return Status.FAILURE;

    const candidate = nearestReachable(ctx.world.map, ctx.world.me, ctx.world.freeParcels(), ctx.world.blockedTiles());
    if (!candidate) return Status.FAILURE;

    const directDelivery       = nearestReachable(ctx.world.map, ctx.world.me, ctx.world.map.deliveryTiles, ctx.world.blockedTiles());
    const deliveryFromCandidate = nearestReachable(ctx.world.map, candidate.target, ctx.world.map.deliveryTiles, ctx.world.blockedTiles());
    if (!directDelivery || !deliveryFromCandidate) return Status.FAILURE;

    const decayMs = decayIntervalMs(ctx);
    const mvMs    = movementMs(ctx);

    const valueDirect = valueAtArrival(ctx.world.carrying(), directDelivery.dist * mvMs, decayMs);
    const valueDetour  = valueAtArrival(
        [...ctx.world.carrying(), candidate.target],
        (candidate.dist + deliveryFromCandidate.dist) * mvMs,
        decayMs,
    );

    if (valueDetour <= valueDirect) return Status.FAILURE; // not worth it → fall through to normal delivery

    await ctx._stepToward(candidate.target);
    ctx.lastAction = `detour → parcel (${candidate.target.x},${candidate.target.y}) [detour=${valueDetour} vs direct=${valueDirect}]`;
    return Status.SUCCESS;
});

/** @param {import('./BtAgent.js').BtAgent} ctx */
function hasCapacityFor(ctx) {
    return ctx.world.carrying().length < getCapacity(ctx);
}

// Heads for the nearest spawner tile, excluding the one you're standing on.
// Since explore only ever runs when no free parcel is known (branch 4 would
// otherwise win), every spawner is "empty" by the time you reach it — so
// dropping the current tile from the candidates is enough to make "nearest"
// naturally advance to the next-nearest spawner once you arrive, with no
// need to remember which ones were already visited.
const explore = new Action(async (ctx) => {
    const spawners = (ctx.world.map?.spawnerTiles ?? [])
        .filter((/** @type {{x:number,y:number}} */ t) => t.x !== ctx.world.me.x || t.y !== ctx.world.me.y);
    const nearest = nearestReachable(ctx.world.map, ctx.world.me, spawners, ctx.world.blockedTiles());
    if (nearest) {
        await ctx._stepToward(nearest.target);
        ctx.lastAction = `explore → spawner (${nearest.target.x},${nearest.target.y})`;
        return Status.SUCCESS;
    }
    const dirs = ['up', 'down', 'left', 'right'];
    await ctx.io.move(dirs[Math.floor(Math.random() * dirs.length)]);
    ctx.lastAction = 'explore (random)';
    return Status.SUCCESS;
});

// ── Base behaviour ─────────────────────────────────────────────────────────────
// The selector above, as a single reusable node. Stateless like every other
// node here, so it can be embedded as a sub-tree/fallback inside a larger
// Selector or Sequence in other trees — e.g.:
//
//   import { baseBehaviour } from './RunningTree.js';
//   new Selector([ new Sequence([someSpecialCase, doSomethingElse]), baseBehaviour ])

export const baseBehaviour = new Selector([
    new Sequence([isCarrying, isAtDelivery, putdown]),
    new Sequence([isParcelHere, hasCapacity, pickup]),
    new Sequence([
        isCarrying,
        new Selector([considerDetour, goToNearestDelivery]), // detour if worth it, else deliver directly
    ]),
    new Sequence([hasFreeParcels, goToNearestParcel]),
    explore,
]);

// ── Tree factory ───────────────────────────────────────────────────────────────

export function buildTree() {
    return baseBehaviour;
}
