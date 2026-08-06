// ─────────────────────────────────────────────────────────────────────────────
// Behaviour Tree for the parcel-collection strategy — object-based composition
// of the generic nodes in BehaviourTree.js. `ctx` is the owning BtAgent
// instance (exposes .world, .io, ._stepToward, .lastAction).
//
//   SELECTOR
//   ├── SEQUENCE: carrying ∧ atDelivery    → putdown
//   ├── SEQUENCE: parcelHere ∧ hasCapacity  → pickup (fires even mid-delivery, if there's room)
//   ├── forcedMove: stuck-recovery override armed by _onStepFailure → consume it, skip pathfinding
//   ├── SEQUENCE: carrying
//   │     └── SELECTOR: detour worth it?    → stepToward(best-value candidate parcel)
//   │                    else               → stepToward(nearestDelivery)
//   ├── SEQUENCE: freeParcels exist          → stepToward(best-value parcel, decay-adjusted — not just nearest,
//   │                                            skips tiles that can't reach a productive delivery↔spawner cycle)
//   └── explore: persisted target ≥ exploreRadius away, safe (leads to a productive cycle),
//                clear of sensed rivals, biased away from sensed teammates (always succeeds)
// ─────────────────────────────────────────────────────────────────────────────

import { Status, Selector, Sequence, Condition, Action } from './BehaviourTree.js';
import { nearestReachable, aStar } from './Pathfinding.js';
import { isSafeTile, safeRandomDirection } from './MapRegions.js';
import { pickExploreTarget } from './ExploreTarget.js';

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

// Highest priority: if a previous stuck-detection armed a forced-direction
// override (see BtAgent._onStepFailure), consume it before any pathfinding
// runs this tick — otherwise a fully-blocked leaf (e.g. delivery tile cut off
// by another agent) would never touch movement and the override would sit
// unused forever.
const forcedMove = new Action(async (/** @type {import('./BtAgent.js').BtAgent} */ ctx) => {
    if (!ctx.hasForcedMove()) return Status.FAILURE;
    const ok = await ctx._consumeForcedMove();
    ctx.lastAction = `forced move → ${ok ? 'ok' : 'rejected'}`;
    return Status.SUCCESS;
});

const goToNearestDelivery = new Action(async (ctx) => {
    const del = nearestReachable(ctx.world.map, ctx.world.me, safeDeliveryPool(ctx), ctx.world.blockedTiles());
    if (del) {
        await ctx._stepToward(del.target);
        ctx.lastAction = `deliver → (${del.target.x},${del.target.y}) dist=${del.dist}`;
    } else {
        ctx._onStepFailure(); // no route at all — likely blocked by another agent
        ctx.lastAction = 'deliver (no route)';
    }
    return Status.SUCCESS;
});

const goToBestParcel = new Action(async (ctx) => {
    const best = bestValuedParcel(ctx, ctx.world.freeParcels());
    if (!best) return Status.FAILURE;
    await ctx._stepToward(best.target);
    ctx.lastAction = `→ parcel (${best.target.x},${best.target.y}) dist=${best.dist} value=${best.value}`;
    return Status.SUCCESS;
});

/**
 * Best reachable parcel by expected reward at arrival (decay-adjusted), not
 * just the closest one — a far high-reward parcel can beat a near one that's
 * about to decay to nothing. Ties broken by shorter distance. Parcels that
 * would be worth 0 on arrival are skipped entirely (not worth the trip).
 * @param {import('./BtAgent.js').BtAgent} ctx
 * @param {{x:number,y:number,reward:number}[]} parcels
 * @returns {{target:{x:number,y:number,reward:number}, dist:number, value:number}|null}
 */
function bestValuedParcel(ctx, parcels) {
    const map = ctx.world.map;
    if (!map) return null;

    const decayMs = decayIntervalMs(ctx);
    const mvMs    = movementMs(ctx);
    const blocked = ctx.world.blockedTiles();

    // Never target a parcel sitting somewhere that can't reach a productive
    // delivery↔spawner cycle afterward (e.g. a pocket that only has delivery
    // tiles, with no way back to any spawner) — better to leave it and fall
    // through to explore than get permanently stuck holding it.
    const safeParcels = parcels.filter((p) => isSafeTile(map, p.x, p.y));

    let best = null;
    let anyReachable = false;
    for (const p of safeParcels) {
        const r = aStar(map, ctx.world.me, p, blocked);
        if (!r) continue;
        anyReachable = true;
        const value = valueAtArrival([p], r.dist * mvMs, decayMs);
        if (value <= 0) continue;
        if (!best || value > best.value || (value === best.value && r.dist < best.dist)) {
            best = { target: p, dist: r.dist, value };
        }
    }
    // Safe parcels exist but every one is unreachable (not just low-value) —
    // that's blockage, not "nothing to do", so it feeds the stuck detector.
    // (Parcels excluded only by the safety filter are normal decision-making,
    // not a stuck condition.)
    if (!best && safeParcels.length > 0 && !anyReachable) ctx._onStepFailure();
    return best;
}

// Compares "deliver now" vs "detour to grab the nearest free parcel, then deliver",
// both valued at arrival time (reward decays 1/tick while travelling — see
// decayIntervalMs). Decay keeps running on parcels already being carried, not
// just ones on the ground, so both scenarios apply it uniformly.
const considerDetour = new Action(async (ctx) => {
    if (!hasCapacityFor(ctx)) return Status.FAILURE;

    const candidate = bestValuedParcel(ctx, ctx.world.freeParcels());
    if (!candidate) return Status.FAILURE;

    const deliveryPool = safeDeliveryPool(ctx);
    const directDelivery       = nearestReachable(ctx.world.map, ctx.world.me, deliveryPool, ctx.world.blockedTiles());
    const deliveryFromCandidate = nearestReachable(ctx.world.map, candidate.target, deliveryPool, ctx.world.blockedTiles());
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

/**
 * Delivery tiles, preferring ones that are actually safe (part of/leading to
 * a productive delivery↔spawner cycle) over ones that are merely reachable —
 * falls back to every delivery tile only if none are safe (still carrying a
 * parcel means it must be delivered somewhere, even into an otherwise-unsafe
 * spot, rather than never delivered at all).
 * @param {import('./BtAgent.js').BtAgent} ctx
 */
function safeDeliveryPool(ctx) {
    const map = ctx.world.map;
    if (!map) return [];
    const safe = map.deliveryTiles.filter((/** @type {{x:number,y:number}} */ t) => isSafeTile(map, t.x, t.y));
    return safe.length ? safe : map.deliveryTiles;
}

// Commits to a target (ctx.exploreTarget, persisted on the agent across
// ticks) chosen by ExploreTarget.pickExploreTarget — at least exploreRadius
// tiles away, skipping unsafe (undeliverable) pockets and rival-occupied
// clusters, biased away from sensed teammates. Keeps walking toward it until
// reached, unwalkable, or a move fails, then re-picks. This is the one leaf
// in the tree that carries state between ticks (see BtAgent.exploreTarget).
const explore = new Action(async (ctx) => {
    const t = ctx.exploreTarget;
    const stale = !t
        || (ctx.world.me.x === t.x && ctx.world.me.y === t.y)
        || !ctx.world.walkable(t.x, t.y);

    if (stale) ctx.exploreTarget = pickExploreTarget(ctx, ctx.exploreRadius, ctx.enemyAvoidRadius);

    if (!ctx.exploreTarget) {
        // No target found anywhere (fully boxed in / degenerate map) — last
        // resort single random step: respects one-way tiles and prefers a
        // neighbour that still leads to a productive delivery↔spawner cycle.
        if (ctx.world.map) {
            const dir = safeRandomDirection(ctx.world.map, ctx.world.me, ctx.world.blockedTiles());
            await ctx.io.move(dir);
        }
        ctx.lastAction = 'explore (random — no target found)';
        return Status.SUCCESS;
    }

    const target = ctx.exploreTarget; // capture before _stepToward may clear it below
    const moved  = await ctx._stepToward(target);
    if (!moved) ctx.exploreTarget = null; // drop it; re-pick next tick
    ctx.lastAction = `explore → (${target.x},${target.y})`;
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
    forcedMove, // consume a stuck-recovery override before any pathfinding, if one is armed
    new Sequence([
        isCarrying,
        new Selector([considerDetour, goToNearestDelivery]), // detour if worth it, else deliver directly
    ]),
    new Sequence([hasFreeParcels, goToBestParcel]),
    explore,
]);

// ── Tree factory ───────────────────────────────────────────────────────────────

export function buildTree() {
    return baseBehaviour;
}
