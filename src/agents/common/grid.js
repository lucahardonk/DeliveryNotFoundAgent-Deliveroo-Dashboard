/**
 * Minimal static-map model + BFS pathfinding shared by every agent.
 *
 * Tile-type codes as reported by the Deliveroo server (stringified):
 *   '0' wall, '1' parcel spawner, '2' delivery, '3' walkable.
 */
export const TILE = {
    wall: '0',
    spawner: '1',
    delivery: '2',
    walkable: '3',
};

/**
 * Builds a `{ width, height, tiles, deliveryTiles, spawnerTiles }` model from the
 * raw tile list emitted by the server `map` event. Width/height are derived from
 * the tile coordinates (the reported dimensions can be wrong).
 *
 * @param {Array<{x:number,y:number,type:string|number}>} rawTiles
 */
export function buildMap(rawTiles) {
    let width = 0;
    let height = 0;
    for (const t of rawTiles) {
        if (t.x > width) width = t.x;
        if (t.y > height) height = t.y;
    }
    width++;
    height++;

    const tiles = Array.from({ length: width }, () => new Array(height).fill(null));
    const deliveryTiles = [];
    const spawnerTiles = [];

    for (const t of rawTiles) {
        const type = String(t.type);
        tiles[t.x][t.y] = type;
        if (type === TILE.delivery) deliveryTiles.push({ x: t.x, y: t.y });
        if (type === TILE.spawner) spawnerTiles.push({ x: t.x, y: t.y });
    }

    return { width, height, tiles, deliveryTiles, spawnerTiles };
}

/** A tile is walkable if it exists on the map and is not a wall. */
export function isWalkable(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const type = map.tiles[x]?.[y];
    return type != null && type !== TILE.wall;
}

/** Orthogonal walkable neighbours of a tile, optionally avoiding blocked tiles. */
function neighbors(map, { x, y }, blocked) {
    const out = [];
    const cand = [
        { x: x + 1, y, dir: 'right' },
        { x: x - 1, y, dir: 'left' },
        { x, y: y + 1, dir: 'up' },
        { x, y: y - 1, dir: 'down' },
    ];
    for (const c of cand) {
        if (!isWalkable(map, c.x, c.y)) continue;
        if (blocked && blocked.has(`${c.x},${c.y}`)) continue;
        out.push(c);
    }
    return out;
}

/**
 * BFS shortest path from `start` to `goal`.
 * @returns {{dist:number, firstStep:'up'|'down'|'left'|'right'|null, path:Array}|null}
 *          null if unreachable. `firstStep` is the direction of the first move.
 */
export function bfs(map, start, goal, blockedTiles = []) {
    if (start.x === goal.x && start.y === goal.y) return { dist: 0, firstStep: null, path: [] };
    const blocked = new Set(blockedTiles.map((b) => `${b.x},${b.y}`));
    const key = (p) => `${p.x},${p.y}`;
    const visited = new Set([key(start)]);
    const queue = [{ pos: start, first: null, path: [] }];

    while (queue.length) {
        const cur = queue.shift();
        for (const n of neighbors(map, cur.pos, blocked)) {
            const k = `${n.x},${n.y}`;
            if (visited.has(k)) continue;
            visited.add(k);
            const first = cur.first ?? n.dir;
            const path = [...cur.path, { x: n.x, y: n.y }];
            if (n.x === goal.x && n.y === goal.y) {
                return { dist: path.length, firstStep: first, path };
            }
            queue.push({ pos: { x: n.x, y: n.y }, first, path });
        }
    }
    return null;
}

/**
 * Finds the nearest reachable target among `goals` (by BFS distance).
 * @returns {{target:object, dist:number, firstStep:string|null}|null}
 */
export function nearestReachable(map, start, goals, blockedTiles = []) {
    let best = null;
    for (const g of goals) {
        const r = bfs(map, start, g, blockedTiles);
        if (r && (!best || r.dist < best.dist)) {
            best = { target: g, dist: r.dist, firstStep: r.firstStep };
        }
    }
    return best;
}
