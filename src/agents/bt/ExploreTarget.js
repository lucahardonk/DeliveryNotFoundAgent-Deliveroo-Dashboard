// ─────────────────────────────────────────────────────────────────────────────
// Explore-target picker for the BT agent's `explore` leaf (RunningTree.js).
// Mirrors the min-radius + shuffle-then-first-reachable pattern already proven
// in src/agents/base_agent/functions.js's pickExploreTarget/doExplore, extended
// with the map-safety filter (MapRegions.isSafeTile) and team-aware scoring:
// avoid rival-occupied clusters, spread out from sensed teammates.
// ─────────────────────────────────────────────────────────────────────────────

import { aStar, manhattan } from './Pathfinding.js';
import { isSafeTile } from './MapRegions.js';

/**
 * @param {import('./BtAgent.js').BtAgent} ctx
 * @param {number} minRadius   - Manhattan distance from self a candidate must exceed.
 * @param {number} enemyRadius - Manhattan distance from any sensed rival a candidate must exceed.
 * @returns {{x:number,y:number}|null}
 */
export function pickExploreTarget(ctx, minRadius = 10, enemyRadius = 5) {
    const map = ctx.world.map;
    if (!map) return null;
    const me = ctx.world.me;

    // 1. Base pool — spawners, else every walkable tile (mirrors functions.js).
    const basePool = map.spawnerTiles.length ? map.spawnerTiles : map.walkableTiles;

    // 2. Safety filter — never target a tile that can't reach a productive
    //    delivery↔spawner cycle afterward. Fall back to the unfiltered pool
    //    only if literally every candidate map-wide is unsafe (degenerate map).
    const safePool = basePool.filter((t) => isSafeTile(map, t.x, t.y));
    const pool1 = safePool.length ? safePool : basePool;

    // 3. Minimum-radius filter. Falls back to pool1 (never past the safety
    //    filter) if nothing qualifies.
    const farPool = pool1.filter((t) => manhattan(t, me) > minRadius);
    const pool2 = farPool.length ? farPool : pool1;

    // 4. Rival-proximity hard exclusion — a rival near one candidate excludes
    //    the whole nearby cluster together. Falls back to pool2 if this would
    //    empty the pool (never sacrifice safety/radius just to dodge a rival).
    const rivals = ctx.world.rivals();
    const clearPool = pool2.filter((t) =>
        rivals.every((r) => manhattan(t, { x: Math.round(r.x), y: Math.round(r.y) }) > enemyRadius));
    const pool3 = clearPool.length ? clearPool : pool2;

    // 5. Teammate-spread soft scoring: farther from the nearest sensed
    //    teammate wins, random tie-break so agents running this same function
    //    don't all deterministically converge on the same "best" tile anyway.
    const teammates = ctx.world.teammates();
    const scored = pool3
        .map((t) => ({ t, spread: nearestTeammateDist(t, teammates), r: Math.random() }))
        .sort((a, b) => (b.spread - a.spread) || (a.r - b.r));

    // 6. First A*-reachable candidate wins.
    for (const { t } of scored) {
        if (t.x === me.x && t.y === me.y) continue;
        if (aStar(map, me, t, ctx.world.blockedTiles())) return t;
    }
    return null;
}

/** @param {{x:number,y:number}} t @param {{x:number,y:number}[]} teammates */
function nearestTeammateDist(t, teammates) {
    if (!teammates.length) return Infinity; // none sensed → no spread signal, pure shuffle
    let best = Infinity;
    for (const tm of teammates) {
        const d = manhattan(t, { x: Math.round(tm.x), y: Math.round(tm.y) });
        if (d < best) best = d;
    }
    return best;
}
