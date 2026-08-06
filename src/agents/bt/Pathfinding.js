import { isWalkable, allowedExitDirection } from './MapModel.js';

/**
 * Walkable orthogonal neighbours, excluding blocked tiles. If (x,y) is a
 * one-way tile, only the neighbour in its single legal exit direction is
 * kept — entering is unrestricted, but there is exactly one way out.
 * @returns {{ x, y, dir }[]}
 */
export function neighbors(map, { x, y }, blocked) {
    const candidates = [
        { x: x + 1, y, dir: 'right' },
        { x: x - 1, y, dir: 'left'  },
        { x, y: y + 1, dir: 'up'    },
        { x, y: y - 1, dir: 'down'  },
    ].filter((c) => isWalkable(map, c.x, c.y) && !blocked.has(`${c.x},${c.y}`));

    const allowedDir = allowedExitDirection(map, x, y);
    return allowedDir ? candidates.filter((c) => c.dir === allowedDir) : candidates;
}

/**
 * BFS shortest path from `start` to `goal`.
 * @param {object[]} blockedTiles  - array of {x,y} to treat as obstacles.
 * @returns {{ dist:number, firstStep:string|null, path:object[] }|null}
 *          null if unreachable.
 */
export function bfs(map, start, goal, blockedTiles = []) {
    if (start.x === goal.x && start.y === goal.y) return { dist: 0, firstStep: null, path: [] };

    const blocked = new Set(blockedTiles.map((b) => `${b.x},${b.y}`));
    const visited = new Set([`${start.x},${start.y}`]);
    const queue   = [{ pos: start, first: null, path: [] }];

    while (queue.length) {
        const cur = queue.shift();
        for (const n of neighbors(map, cur.pos, blocked)) {
            const k = `${n.x},${n.y}`;
            if (visited.has(k)) continue;
            visited.add(k);
            const first = cur.first ?? n.dir;
            const path  = [...cur.path, { x: n.x, y: n.y }];
            if (n.x === goal.x && n.y === goal.y) return { dist: path.length, firstStep: first, path };
            queue.push({ pos: { x: n.x, y: n.y }, first, path });
        }
    }
    return null;
}

/**
 * Manhattan distance — admissible for a 4-directional, uniform-cost grid.
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 */
export function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* shortest path from `start` to `goal`. Same contract as `bfs` (and, on
 * this uniform-cost grid, the same result) but expands fewer nodes by
 * prioritising tiles closer to the goal.
 * @param {object} map
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} goal
 * @param {object[]} blockedTiles  - array of {x,y} to treat as obstacles.
 * @returns {{ dist:number, firstStep:string|null, path:object[] }|null}
 *          null if unreachable.
 */
export function aStar(map, start, goal, blockedTiles = []) {
    if (start.x === goal.x && start.y === goal.y) return { dist: 0, firstStep: null, path: [] };

    const blocked = new Set(blockedTiles.map((b) => `${b.x},${b.y}`));
    const bestG   = new Map([[`${start.x},${start.y}`, 0]]);
    const open    = [{ pos: start, first: /** @type {string|null} */ (null), path: /** @type {{x:number,y:number}[]} */ ([]), g: 0, f: manhattan(start, goal) }];

    while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
        const cur = open.splice(bi, 1)[0];

        if (cur.pos.x === goal.x && cur.pos.y === goal.y) {
            return { dist: cur.path.length, firstStep: cur.first, path: cur.path };
        }

        for (const n of neighbors(map, cur.pos, blocked)) {
            const k = `${n.x},${n.y}`;
            const g = cur.g + 1;
            if (bestG.has(k) && /** @type {number} */ (bestG.get(k)) <= g) continue;
            bestG.set(k, g);
            const first = cur.first ?? n.dir;
            const path  = [...cur.path, { x: n.x, y: n.y }];
            open.push({ pos: { x: n.x, y: n.y }, first, path, g, f: g + manhattan(n, goal) });
        }
    }
    return null;
}

/**
 * Finds the nearest reachable target among `goals` by A* distance.
 * @returns {{ target, dist, firstStep }|null}
 */
export function nearestReachable(map, start, goals, blockedTiles = []) {
    let best = null;
    for (const g of goals) {
        const r = aStar(map, start, g, blockedTiles);
        if (r && (!best || r.dist < best.dist)) best = { target: g, dist: r.dist, firstStep: r.firstStep };
    }
    return best;
}