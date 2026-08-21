// ─────────────────────────────────────────────────────────────────────────────
// functions.js — shared agent logic
//
// Contains:
// - logging and world-state printing
// - normal parcel collection / delivery strategy
// - random exploration when no parcels are visible
// - A* navigation helpers
// - pickup and putdown actions
//
// Kept separate from LlmAgent.js so the agent class stays a thin orchestrator.
// ─────────────────────────────────────────────────────────────────────────────

import { astar, direction } from './astar.js';

// ── Strategy configuration ───────────────────────────────────────────────────

// Continue collecting until the agent carries more than this amount.
// With value 10 and the `>` condition below, delivery starts at 11 parcels.
const MAX_PARCELS_BEFORE_DELIVERY = 10;

// ── Debug ─────────────────────────────────────────────────────────────────────

/**
 * Prints a tagged log message for one agent.
 *
 * @param {string} name
 * @param {string} tag
 * @param {string} msg
 * @returns {void}
 */
export function log(name, tag, msg) {
    console.log(`[${name}][${tag}] ${msg}`);
}

// ── World-state printing ──────────────────────────────────────────────────────

/**
 * Prints a compact snapshot of the agent's current world state.
 *
 * @param {object} agent
 * @returns {void}
 */
export function printWorldState(agent) {
    const me = agent.world.me;
    const free = agent.world.freeParcels();
    const carrying = agent.world.carrying();

    console.log('──────────────────────────────────────────────');
    console.log(`[${agent.name}] state=${agent.state}`);
    console.log(`  me:        id=${me.id}  pos=(${me.x},${me.y})  score=${me.score}`);
    console.log(`  carrying:  ${carrying.length}  [${carrying.map((parcel) => parcel.id).join(', ')}]`);
    console.log(`  free:      ${free.length}  [${free.map((parcel) => `${parcel.id}@(${parcel.x},${parcel.y})`).join(', ')}]`);
    console.log(`  others:    ${agent.world.others.length}`);
    console.log(`  target:    ${agent.target ? `(${agent.target.x},${agent.target.y})` : 'none'}`);
    console.log('──────────────────────────────────────────────');
}

// ── Normal strategy: collect, deliver, explore ────────────────────────────────

/**
 * Returns true when the normal strategy should go to a delivery tile.
 *
 * Delivery conditions:
 * - the agent carries more than MAX_PARCELS_BEFORE_DELIVERY parcels; or
 * - no free parcels are visible and the agent carries at least one parcel.
 *
 * @param {object[]} carrying
 * @param {object[]} freeParcels
 * @returns {boolean}
 */
export function shouldDeliverNormally(carrying, freeParcels) {
    const carryingTooMany = carrying.length > MAX_PARCELS_BEFORE_DELIVERY;
    const noParcelsVisible = freeParcels.length === 0;
    const hasParcelsToDeliver = carrying.length > 0;

    return carryingTooMany || (noParcelsVisible && hasParcelsToDeliver);
}

/**
 * Selects a random walkable and reachable tile anywhere on the map.
 *
 * The function takes all known non-wall map tiles from `walkableTiles`,
 * shuffles them, then returns the first one that is reachable using A*.
 *
 * @param {object} agent
 * @returns {{ x: number, y: number } | null}
 */
export function randomExplorationTarget(agent) {
    const walkableTiles = agent.world.map?.walkableTiles ?? [];
    const blocked = blockedCells(agent);

    if (walkableTiles.length === 0) {
        //log(agent.name, 'explore', 'map has no walkable tiles');
        return null;
    }

    // Copy the map list before shuffling: do not alter WorldModel's map data.
    const candidates = [...walkableTiles];

    // Fisher-Yates shuffle: inspect map tiles in a different random order
    // every time the agent needs to explore.
    for (let index = candidates.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));

        [candidates[index], candidates[randomIndex]] = [
            candidates[randomIndex],
            candidates[index],
        ];
    }

    const currentX = Math.round(agent.world.me.x);
    const currentY = Math.round(agent.world.me.y);
    const currentKey = `${currentX},${currentY}`;

    // Return the first randomly selected tile that the agent can reach.
    for (const target of candidates) {
        const targetKey = `${target.x},${target.y}`;

        // Do not explore toward the tile on which the agent already stands.
        if (targetKey === currentKey) {
            continue;
        }

        // Do not intentionally choose another visible agent's position.
        if (blocked.has(targetKey)) {
            continue;
        }

        const path = astar(
            agent.world.me,
            target,
            (x, y) => agent.world.walkable(x, y),
            blocked,
        );

        if (path && path.length > 0) {
            //log(agent.name,'explore',`random target=(${target.x},${target.y}) pathLen=${path.length}`,);
            return { x: target.x, y: target.y };
        }
    }

    // This should happen only if no other walkable map tile is reachable.
    //log(agent.name, 'explore', 'no reachable walkable map tile found');
    return null;
}

/**
 * Chooses a target for the default behaviour.
 *
 * Priority:
 * 1. Deliver if the carrying limit has been exceeded.
 * 2. Otherwise, collect the nearest visible reachable parcel.
 * 3. If no parcels are visible but some are carried, deliver them.
 * 4. If empty-handed and no parcels are visible, explore randomly.
 *
 * @param {object} agent
 * @returns {{ x: number, y: number } | null}
 */
export function normalTarget(agent) {
    const carrying = agent.world.carrying();
    const freeParcels = agent.world.freeParcels();

    // Deliver at 11+ parcels, or if there are no visible parcels left to get.
    if (shouldDeliverNormally(carrying, freeParcels)) {
        const delivery = nearest(agent, agent.world.map.deliveryTiles);

        if (delivery) {
            //log(agent.name,'think',`deliver ${carrying.length} parcel(s) → (${delivery.x},${delivery.y})`,);
        }

        return delivery;
    }

    // While under the delivery threshold, collect a visible reachable parcel.
    const parcel = nearest(agent, freeParcels);

    if (parcel) {
        //log( agent.name,'think', `collect parcel → (${parcel.x},${parcel.y}); carrying=${carrying.length}`,);
        return parcel;
    }

    // Empty-handed and no parcel is currently visible: explore the map.
    //log(agent.name, 'think', 'no parcels visible — exploring');
    return randomExplorationTarget(agent);
}

/**
 * Main decision entry point used by LlmAgent.js.
 *
 * Later, this can select an LLM/Hermes mission strategy instead of
 * normalTarget(agent), while LlmAgent.js remains unchanged.
 *
 * @param {object} agent
 * @returns {{ x: number, y: number } | null}
 */
export function think(agent) {
    return normalTarget(agent);
}

// ── Target selection and pathfinding ──────────────────────────────────────────

/**
 * Builds a set of cells occupied by other visible agents.
 *
 * @param {object} agent
 * @returns {Set<string>}
 */
export function blockedCells(agent) {
    return new Set(
        agent.world.others.map(
            (other) => `${Math.round(other.x)},${Math.round(other.y)}`,
        ),
    );
}

/**
 * Returns the reachable goal with the shortest A* path.
 *
 * @param {object} agent
 * @param {{ x: number, y: number }[]} goals
 * @returns {{ x: number, y: number } | null}
 */
export function nearest(agent, goals) {
    const blocked = blockedCells(agent);

    let best = null;
    let bestPathLength = Infinity;

    for (const goal of goals) {
        const path = astar(
            agent.world.me,
            goal,
            (x, y) => agent.world.walkable(x, y),
            blocked,
        );

        if (path && path.length < bestPathLength) {
            best = { x: goal.x, y: goal.y };
            bestPathLength = path.length;
        }
    }

    return best;
}

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * Performs one A* movement step toward a target.
 *
 * @param {object} agent
 * @param {{ x: number, y: number }} target
 * @returns {Promise<boolean>} true when a move command succeeds
 */
export async function stepToward(agent, target) {
    const blocked = blockedCells(agent);

    // A target may be occupied and still be a valid destination:
    // for example, a parcel tile or a delivery tile.
    blocked.delete(`${target.x},${target.y}`);

    const path = astar(
        agent.world.me,
        target,
        (x, y) => agent.world.walkable(x, y),
        blocked,
    );

    if (!path || path.length === 0) {
        //log(agent.name, 'astar', `no path to (${target.x},${target.y})`);
        return false;
    }

    const next = path[0];
    const moveDirection = direction(agent.world.me, next);

    //log(agent.name,'move', `dir=${moveDirection} → next=(${next.x},${next.y}) pathLen=${path.length}`,);

    return Boolean(await agent.io.doMove(moveDirection));
}

// ── Actions on the current tile ───────────────────────────────────────────────

/**
 * Executes an action available on the current tile.
 *
 * Pickup always has priority. If the agent is on a delivery tile that also
 * contains a free parcel, it collects the parcel before trying to put down.
 *
 * @param {object} agent
 * @returns {Promise<boolean>} true when an action succeeds
 */
export async function actOnTile(agent) {
    // Pick up every free parcel encountered while navigating.
    if (agent.world.parcelHere()) {
        const ok = await agent.io.doPickup();
        //log(agent.name, 'act', `pickup → ${ok ? 'ok' : 'fail'}`);
        return Boolean(ok);
    }

    // Deliver only if there is no free parcel on this tile.
    if (agent.world.carrying().length > 0 && agent.world.atDelivery()) {
        const ok = await agent.io.doPutdown();
        //log(agent.name, 'act', `putdown → ${ok ? 'ok' : 'fail'}`);
        return Boolean(ok);
    }

    return false;
}