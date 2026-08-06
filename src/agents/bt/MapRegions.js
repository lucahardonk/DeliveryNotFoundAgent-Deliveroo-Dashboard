// ─────────────────────────────────────────────────────────────────────────────
// Static map safety analysis. One-way tiles (see MapModel.allowedExitDirection —
// exactly one legal exit direction, the reverse of the visual arrow) mean
// reachability is directed, not just wall-connectivity.
//
// "Can reach a delivery tile" alone is NOT enough to call a tile safe: a
// pocket that contains only delivery tiles (reachable but with no way back
// out to any spawner) still traps the agent forever after the first
// drop-off — one successful delivery, then permanently useless for the rest
// of the match. The real safety condition is: can this tile reach a
// *productive* zone, where at least one delivery tile and at least one
// spawner tile can reach EACH OTHER (so the agent can cycle pick-up →
// deliver → pick-up forever)? "Can reach each other" is exactly what a
// strongly-connected component (SCC) captures, so safety here is computed
// via Kosaraju's algorithm: find SCCs, mark the ones containing both a
// delivery and a spawner tile as "core", then flag every tile that can
// reach some core SCC as safe.
//
// computeRegions() runs once per map load and is cached on map.regions.
// ─────────────────────────────────────────────────────────────────────────────

import { neighbors } from './Pathfinding.js';
import { TILE } from './MapModel.js';

/**
 * @param {{width:number, height:number, tiles:string[][], deliveryTiles:{x:number,y:number}[], spawnerTiles:{x:number,y:number}[], walkableTiles:{x:number,y:number}[]}} map
 * @returns {{
 *   regionId: (number|null)[][],
 *   sccId: (number|null)[][],
 *   safeGrid: boolean[][],
 *   statusGrid: ('green'|'red'|null)[][],
 *   list: {id:number, tileCount:number, hasDelivery:boolean, hasSpawner:boolean, safeTileCount:number, trappedTileCount:number, status:'green'|'red'}[],
 * }}
 */
export function computeRegions(map) {
    const { width, height, walkableTiles } = map;

    // Region safety is a static map property, independent of where other
    // agents currently stand — never use world.blockedTiles() here.
    const noBlock = new Set();

    /** @type {{x:number,y:number}[][][]} */
    const fwd = Array.from({ length: width }, () => new Array(height).fill(null));
    /** @type {{x:number,y:number}[][][]} */
    const rev = Array.from({ length: width }, () => new Array(height).fill(null));
    for (const p of walkableTiles) {
        fwd[p.x][p.y] = [];
        rev[p.x][p.y] = [];
    }
    for (const p of walkableTiles) {
        for (const n of neighbors(map, p, noBlock)) {
            fwd[p.x][p.y].push({ x: n.x, y: n.y });
            rev[n.x][n.y].push({ x: p.x, y: p.y });
        }
    }

    // ── Strongly-connected components (Kosaraju), iterative to avoid stack
    // overflow on larger maps. Two DFS passes over the same walkable tiles.

    // Pass 1: DFS on forward edges, record finish order.
    const seen1 = Array.from({ length: width }, () => new Array(height).fill(false));
    const finishOrder = [];
    for (const start of walkableTiles) {
        if (seen1[start.x][start.y]) continue;
        const stack = [{ node: start, i: 0 }];
        seen1[start.x][start.y] = true;
        while (stack.length) {
            const top = stack[stack.length - 1];
            const children = fwd[top.node.x][top.node.y];
            if (top.i < children.length) {
                const child = children[top.i++];
                if (!seen1[child.x][child.y]) {
                    seen1[child.x][child.y] = true;
                    stack.push({ node: child, i: 0 });
                }
            } else {
                finishOrder.push(top.node);
                stack.pop();
            }
        }
    }

    // Pass 2: process in reverse finish order, DFS on the transposed (rev)
    // graph — each resulting tree is one SCC.
    const sccId = Array.from({ length: width }, () => new Array(height).fill(null));
    const sccs = [];
    for (let i = finishOrder.length - 1; i >= 0; i--) {
        const start = finishOrder[i];
        if (sccId[start.x][start.y] != null) continue;
        const id = sccs.length;
        const tiles = [];
        const stack = [start];
        sccId[start.x][start.y] = id;
        while (stack.length) {
            const node = stack.pop();
            tiles.push(node);
            for (const n of rev[node.x][node.y]) {
                if (sccId[n.x][n.y] == null) {
                    sccId[n.x][n.y] = id;
                    stack.push(n);
                }
            }
        }
        sccs.push({ id, tiles, hasDelivery: false, hasSpawner: false });
    }
    for (const p of walkableTiles) {
        const scc = sccs[sccId[p.x][p.y]];
        const type = map.tiles[p.x][p.y];
        if (type === TILE.delivery) scc.hasDelivery = true;
        if (type === TILE.spawner)  scc.hasSpawner  = true;
    }

    // A "core" SCC has both a delivery and a spawner tile mutually
    // reachable (that's what being in the same SCC means) — standing
    // anywhere in one, the agent can cycle pick-up → deliver forever.
    const coreTiles = sccs.filter((s) => s.hasDelivery && s.hasSpawner).flatMap((s) => s.tiles);

    // safeGrid: every tile that can reach *some* core SCC — the real
    // safety predicate target-selection filters on (see isSafeTile below).
    const safeGrid = reverseReachability(width, height, rev, coreTiles);

    const statusGrid = Array.from({ length: width }, () => new Array(height).fill(null));
    for (const p of walkableTiles) {
        statusGrid[p.x][p.y] = safeGrid[p.x][p.y] ? 'green' : 'red';
    }

    // regionId: undirected (weakly-connected) flood-fill, for dashboard
    // grouping/debugging only — walks both fwd and rev edges, ignoring
    // one-way direction. NOT the safety mechanism (safeGrid is).
    const regionId = Array.from({ length: width }, () => new Array(height).fill(null));
    const list = [];
    let nextId = 0;
    for (const start of walkableTiles) {
        if (regionId[start.x][start.y] != null) continue;
        const id = nextId++;
        const region = { id, tileCount: 0, hasDelivery: false, hasSpawner: false, safeTileCount: 0, trappedTileCount: 0 };
        const stack = [start];
        regionId[start.x][start.y] = id;
        while (stack.length) {
            const p = stack.pop();
            region.tileCount++;
            const type = map.tiles[p.x][p.y];
            if (type === TILE.delivery) region.hasDelivery = true;
            if (type === TILE.spawner)  region.hasSpawner  = true;
            if (safeGrid[p.x][p.y]) region.safeTileCount++;
            for (const n of [...fwd[p.x][p.y], ...rev[p.x][p.y]]) {
                if (regionId[n.x][n.y] == null) {
                    regionId[n.x][n.y] = id;
                    stack.push(n);
                }
            }
        }
        region.trappedTileCount = region.tileCount - region.safeTileCount;
        // A region is 'green' if any of its tiles can actually reach a
        // productive (delivery ↔ spawner) cycle — 'red' otherwise, even if
        // it happens to contain a delivery tile (see module header).
        region.status = region.safeTileCount > 0 ? 'green' : 'red';
        list.push(region);
    }

    return { regionId, sccId, safeGrid, statusGrid, list };
}

/** Multi-source reverse BFS: which tiles have a forward path to one of `seeds`. */
function reverseReachability(width, height, rev, seeds) {
    const reach = Array.from({ length: width }, () => new Array(height).fill(false));
    const queue = [];
    for (const s of seeds) {
        if (!reach[s.x][s.y]) { reach[s.x][s.y] = true; queue.push(s); }
    }
    while (queue.length) {
        const cur = queue.shift();
        for (const p of rev[cur.x]?.[cur.y] ?? []) {
            if (!reach[p.x][p.y]) { reach[p.x][p.y] = true; queue.push(p); }
        }
    }
    return reach;
}

/**
 * Whether (x,y) can reach a "core" zone (delivery ↔ spawner mutually
 * reachable) — the real safety check: this is required before ever
 * *choosing* to walk toward (x,y) as a parcel/explore/delivery target.
 * @param {object} map
 * @param {number} x
 * @param {number} y
 */
export function isSafeTile(map, x, y) {
    return map?.regions?.safeGrid?.[x]?.[y] ?? false;
}

/**
 * Last-resort random step (no committed target available) — respects
 * one-way tiles and treats blockedTiles (other agents) as obstacles, same as
 * real pathfinding, and prefers a neighbour that is actually safe (can reach
 * a productive delivery↔spawner cycle) so a blind fallback move never
 * wanders into a dead-end pocket. Falls back to any valid neighbour if none
 * are safe (shouldn't normally happen — the tile you're standing on is
 * presumably itself safe), and to a raw compass direction only if truly
 * boxed in with no valid neighbour at all.
 * @param {object} map
 * @param {{x:number,y:number}} pos
 * @param {{x:number,y:number}[]} blockedTiles
 */
export function safeRandomDirection(map, pos, blockedTiles = []) {
    const blocked = new Set(blockedTiles.map((b) => `${b.x},${b.y}`));
    const candidates = neighbors(map, pos, blocked);
    const dirs = ['up', 'down', 'left', 'right'];
    if (!candidates.length) return dirs[Math.floor(Math.random() * dirs.length)];

    const safe = candidates.filter((c) => isSafeTile(map, c.x, c.y));
    const pool = safe.length ? safe : candidates;
    return pool[Math.floor(Math.random() * pool.length)].dir;
}
