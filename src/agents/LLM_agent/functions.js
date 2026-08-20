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

// When idle, explore a random reachable target at least 11 tiles away.
const EXPLORATION_MIN_RADIUS = 11;
const EXPLORATION_MAX_RADIUS = 15;
const EXPLORATION_ATTEMPTS = 200;

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
 * Selects a random walkable and reachable exploration target.
 *
 * The target is chosen between EXPLORATION_MIN_RADIUS and
 * EXPLORATION_MAX_RADIUS tiles from the current position.
 *
 * @param {object} agent
 * @returns {{ x: number, y: number } | null}
 */
export function randomExplorationTarget(agent) {
    const blocked = blockedCells(agent);
    const startX = Math.round(agent.world.me.x);
    const startY = Math.round(agent.world.me.y);

    for (let attempt = 0; attempt < EXPLORATION_ATTEMPTS; attempt += 1) {
        const angle = Math.random() * Math.PI * 2;

        const radius =
            EXPLORATION_MIN_RADIUS +
            Math.random() * (EXPLORATION_MAX_RADIUS - EXPLORATION_MIN_RADIUS);

        const target = {
            x: Math.round(startX + Math.cos(angle) * radius),
            y: Math.round(startY + Math.sin(angle) * radius),
        };

        // Ignore walls, non-map cells, or occupied cells.
        if (!agent.world.walkable(target.x, target.y)) {
            continue;
        }

        if (blocked.has(`${target.x},${target.y}`)) {
            continue;
        }

        // Confirm that A* can actually reach the random target.
        const path = astar(
            agent.world.me,
            target,
            (x, y) => agent.world.walkable(x, y),
            blocked,
        );

        if (path && path.length > 0) {
            log(
                agent.name,
                'explore',
                `target=(${target.x},${target.y}) pathLen=${path.length}`,
            );

            return target;
        }
    }

    log(agent.name, 'explore', 'no reachable random exploration target found');
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

    // Deliver at 11+ parcels, or when there is nothing else visible to collect.
    if (shouldDeliverNormally(carrying, freeParcels)) {
        const delivery = nearest(agent, agent.world.map.deliveryTiles);

        if (delivery) {
            log(
                agent.name,
                'think',
                `deliver ${carrying.length} parcel(s) → (${delivery.x},${delivery.y})`,
            );
        }

        return delivery;
    }

    // While under the delivery threshold, collect a visible reachable parcel.
    const parcel = nearest(agent, freeParcels);

    if (parcel) {
        log(
            agent.name,
            'think',
            `collect parcel → (${parcel.x},${parcel.y}); carrying=${carrying.length}`,
        );

        return parcel;
    }

    // Empty-handed and no parcel is currently visible: search elsewhere.
    log(agent.name, 'think', 'no parcels visible — exploring');
    return randomExplorationTarget(agent);
}

/**
 * Main decision entry point used by LlmAgent.js.
 *
 * Later, this can select an LLM/Hermes mission strategy instead of
 * normalTarget(agent), while the orchestration code stays unchanged.
 *
 * @param {object} agent
 * @returns {{ x: number, y: number } | null}
 */
export function think(agent) {
    return normalTarget(agent);
}

// ── Target selection and pathfinding ──────────────────────────────────────────

/**
 * Builds a set of occupied cells from other agents.
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

    // A goal itself can be occupied and still be a valid destination,
    // such as a parcel tile or a delivery tile.
    blocked.delete(`${target.x},${target.y}`);

    const path = astar(
        agent.world.me,
        target,
        (x, y) => agent.world.walkable(x, y),
        blocked,
    );

    if (!path || path.length === 0) {
        log(agent.name, 'astar', `no path to (${target.x},${target.y})`);
        return false;
    }

    const next = path[0];
    const moveDirection = direction(agent.world.me, next);

    log(
        agent.name,
        'move',
        `dir=${moveDirection} → next=(${next.x},${next.y}) pathLen=${path.length}`,
    );

    return Boolean(await agent.io.doMove(moveDirection));
}

// ── Actions on the current tile ───────────────────────────────────────────────

/**
 * Executes an action available on the current tile.
 *
 * Pickup always has priority. This means that if the agent walks onto a
 * delivery tile containing a free parcel, it picks up that parcel first.
 *
 * @param {object} agent
 * @returns {Promise<boolean>} true when an action succeeds
 */
export async function actOnTile(agent) {
    // Pick up every free parcel encountered while navigating.
    if (agent.world.parcelHere()) {
        const ok = await agent.io.doPickup();
        log(agent.name, 'act', `pickup → ${ok ? 'ok' : 'fail'}`);
        return Boolean(ok);
    }

    // Deliver only if there is no parcel under the agent.
    if (agent.world.carrying().length > 0 && agent.world.atDelivery()) {
        const ok = await agent.io.doPutdown();
        log(agent.name, 'act', `putdown → ${ok ? 'ok' : 'fail'}`);
        return Boolean(ok);
    }

    return false;
}