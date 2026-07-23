import { isWalkable } from './MapModel.js';

/** @returns {{ x, y, dir }[]} walkable orthogonal neighbours, excluding blocked tiles. */
function neighbors(map, { x, y }, blocked) {
    return [
        { x: x + 1, y, dir: 'right' },
        { x: x - 1, y, dir: 'left'  },
        { x, y: y + 1, dir: 'up'    },
        { x, y: y - 1, dir: 'down'  },
    ].filter((c) => isWalkable(map, c.x, c.y) && !blocked.has(`${c.x},${c.y}`));
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
 * Finds the nearest reachable target among `goals` by BFS distance.
 * @returns {{ target, dist, firstStep }|null}
 */
export function nearestReachable(map, start, goals, blockedTiles = []) {
    let best = null;
    for (const g of goals) {
        const r = bfs(map, start, g, blockedTiles);
        if (r && (!best || r.dist < best.dist)) best = { target: g, dist: r.dist, firstStep: r.firstStep };
    }
    return best;
}