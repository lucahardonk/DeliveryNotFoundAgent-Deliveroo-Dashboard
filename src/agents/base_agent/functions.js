import { astar, direction } from './astar.js';
import { report }           from './Dashboard.js';

// ── Debug ─────────────────────────────────────────────────────────────────────

export function log(name, tag, msg) {
    console.log(`[${name}][${tag}] ${msg}`);
}

// ── Decision logic ────────────────────────────────────────────────────────────

export async function decide(agent) {
    if (agent.world.carrying().length > 0) {
        agent.state = agent.STATE.DELIVERING;
        return doDeliver(agent);
    }

    const here = agent.world.parcelHere();
    if (here) {
        agent.state = agent.STATE.PICKING_UP;
        log(agent.name, 'decide', `parcel ${here.id} on tile — pickup`);
        const ok = await agent.io.doPickup();
        return ok ? `picked up ${here.id}` : `pickup failed for ${here.id}`;
    }

    const nearest = nearestReachable(agent, agent.world.freeParcels());
    if (nearest) {
        agent.state = agent.STATE.PICKING_UP;
        log(agent.name, 'decide', `heading to parcel ${nearest.target.id} at (${nearest.target.x},${nearest.target.y}) dist=${nearest.distance}`);
        const moved = await stepToward(agent, nearest.target);
        return moved
            ? `→ parcel (${nearest.target.x},${nearest.target.y})`
            : `unreachable parcel ${nearest.target.id}`;
    }

    agent.state = agent.STATE.EXPLORING;
    return doExplore(agent);
}

export async function doDeliver(agent) {
    if (agent.world.atDelivery()) {
        log(agent.name, 'decide', 'at delivery tile — putdown');
        const ok = await agent.io.doPutdown();
        return ok ? 'delivered' : 'putdown failed';
    }

    const delivery = nearestReachable(agent, agent.world.map.deliveryTiles);
    if (!delivery) return 'no reachable delivery tile';

    log(agent.name, 'decide', `heading to delivery (${delivery.target.x},${delivery.target.y}) dist=${delivery.distance}`);
    const moved = await stepToward(agent, delivery.target);
    return moved
        ? `→ delivery (${delivery.target.x},${delivery.target.y})`
        : 'delivery unreachable';
}

export async function doExplore(agent) {
    if (
        !agent.searchTarget ||
        agent.world.isAt(agent.searchTarget) ||
        !agent.world.walkable(agent.searchTarget.x, agent.searchTarget.y)
    ) {
        agent.searchTarget = pickExploreTarget(agent, agent.exploreRadius);
        log(agent.name, 'explore', agent.searchTarget
            ? `new target (${agent.searchTarget.x},${agent.searchTarget.y})`
            : 'no target found');
    }

    if (!agent.searchTarget) return 'no exploration target';

    const moved = await stepToward(agent, agent.searchTarget);
    if (!moved) {
        agent.searchTarget = null;
        return 'explore target unreachable';
    }
    return `exploring → (${agent.searchTarget.x},${agent.searchTarget.y})`;
}

// ── Navigation ────────────────────────────────────────────────────────────────

export async function stepToward(agent, target) {
    const blocked = new Set(
        agent.world.others.map((a) => `${Math.round(a.x)},${Math.round(a.y)}`),
    );
    blocked.delete(`${target.x},${target.y}`);

    const path = astar(
        agent.world.me,
        target,
        (x, y) => agent.world.walkable(x, y),
        blocked,
    );

    if (!path || path.length === 0) {
        log(agent.name, 'astar', `no path from (${agent.world.me.x},${agent.world.me.y}) to (${target.x},${target.y})`);
        return false;
    }

    const next = path[0];
    const dir  = direction(agent.world.me, next);
    log(agent.name, 'astar', `path len=${path.length}  next=(${next.x},${next.y})  dir=${dir}`);

    const ok = await agent.io.doMove(dir);
    log(agent.name, 'move', `${dir} → ${ok ? 'ok' : 'FAILED'}`);
    return Boolean(ok);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param {number} minRadius — minimum Manhattan distance from current position.
 */
export function pickExploreTarget(agent, minRadius = 5) {
    const pool = agent.world.map.spawnerTiles.length
        ? agent.world.map.spawnerTiles
        : agent.world.map.walkableTiles;

    const { x: mx, y: my } = agent.world.me;

    const farPool = pool.filter(
        (t) => Math.abs(t.x - mx) + Math.abs(t.y - my) > minRadius,
    );

    const candidates = farPool.length ? farPool : pool;
    const shuffled   = [...candidates].sort(() => Math.random() - 0.5);

    const blocked = new Set(
        agent.world.others.map((a) => `${Math.round(a.x)},${Math.round(a.y)}`),
    );

    for (const t of shuffled) {
        if (!agent.world.isAt(t)) {
            const path = astar(agent.world.me, t, (x, y) => agent.world.walkable(x, y), blocked);
            if (path !== null) return t;
        }
    }

    return null;
}

/**
 * @param {{ x: number, y: number }[]} goals
 * @returns {{ target: object, distance: number } | null}
 */
export function nearestReachable(agent, goals) {
    const blocked = new Set(
        agent.world.others.map((a) => `${Math.round(a.x)},${Math.round(a.y)}`),
    );

    let best = null;

    for (const target of goals) {
        const path = astar(agent.world.me, target, (x, y) => agent.world.walkable(x, y), blocked);
        if (path === null) continue;
        if (!best || path.length < best.distance) {
            best = { target, distance: path.length };
        }
    }

    return best;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function postReport(agent, status, action) {
    await report(agent.dashboardUrl, {
        id:          agent.world.me.id ?? agent.name,
        type:        'greedy',
        label:       agent.name,
        status,
        action,
        position:    { x: agent.world.me.x, y: agent.world.me.y },
        score:       agent.world.me.score,
        carrying:    agent.world.carrying().length,
        freeParcels: agent.world.freeParcels().length,
        map:         agent.world.map
                        ? { width: agent.world.map.width, height: agent.world.map.height }
                        : null,
        updatedAt:   Date.now(),
    });
}