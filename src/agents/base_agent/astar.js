// ─────────────────────────────────────────────────────────────────────────────
// A* Pathfinding — pure module, no external dependencies.
//
// The grid uses integer (x, y) coordinates.
// "Up" increases y, "right" increases x (matches the Deliveroo server).
//
// walkableFn(x, y) -> bool   provided by the caller (WorldModel)
// blocked          -> Set<"x,y">  cells to treat as walls (other agents)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the shortest path from start to goal as an ordered list of steps,
 * NOT including the start cell but INCLUDING the goal cell.
 *
 * Returns [] if start === goal (already there).
 * Returns null if no path exists.
 *
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} goal
 * @param {(x: number, y: number) => boolean} walkableFn
 * @param {Set<string>} [blocked]
 * @returns {{ x: number, y: number }[] | null}
 */
export function astar(start, goal, walkableFn, blocked = new Set()) {
    if (start.x === goal.x && start.y === goal.y) return [];

    // Each cell is keyed as "x,y" for O(1) lookup in Sets and Maps.
    const key = (p) => `${p.x},${p.y}`;

    // Manhattan distance — admissible heuristic on a 4-connected grid
    // (never overestimates, so A* is guaranteed optimal).
    const h = (p) => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);

    // Open list: nodes to evaluate. Sorted by f = g + h every iteration.
    // For the map sizes in Deliveroo (≤ 30x30) a simple array sort is fine;
    // a binary heap would be needed for larger grids.
    const open = [{ x: start.x, y: start.y, g: 0, f: h(start) }];

    // came.get(key) -> parent cell  (used to reconstruct the path)
    const came = new Map();

    // g.get(key) -> best known cost from start to that cell
    const g = new Map([[key(start), 0]]);

    const DIRS = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
    ];

    while (open.length > 0) {
        // Pop the node with the lowest f score.
        open.sort((a, b) => a.f - b.f);
        const cur = open.shift();

        // Goal reached — walk back through `came` to build the path.
        if (cur.x === goal.x && cur.y === goal.y) {
            const path = [];
            let c = cur;
            while (!(c.x === start.x && c.y === start.y)) {
                path.unshift({ x: c.x, y: c.y });
                c = came.get(key(c));
                if (!c) return null; // should never happen
            }
            return path;
        }

        for (const { dx, dy } of DIRS) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            const nk = `${nx},${ny}`;

            // Skip walls and cells occupied by other agents.
            // The goal cell is always allowed even if another agent is there
            // (we'll arrive after they move, or we need to pick up a parcel).
            if (!walkableFn(nx, ny) || blocked.has(nk)) continue;

            const ng = (g.get(key(cur)) ?? Infinity) + 1;
            if (ng >= (g.get(nk) ?? Infinity)) continue; // not an improvement

            g.set(nk, ng);
            came.set(nk, { x: cur.x, y: cur.y });

            const node = { x: nx, y: ny, g: ng, f: ng + h({ x: nx, y: ny }) };
            const idx  = open.findIndex((n) => n.x === nx && n.y === ny);
            if (idx >= 0) open[idx] = node; // update in-place if already queued
            else open.push(node);
        }
    }

    return null; // no path found
}

/**
 * Converts two adjacent integer cells into a movement direction string.
 * Returns null if the cells are not adjacent (caller should handle that).
 *
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number }} to
 * @returns {'right'|'left'|'up'|'down'|null}
 */
export function direction(from, to) {
    if (to.x === from.x + 1) return 'right';
    if (to.x === from.x - 1) return 'left';
    if (to.y === from.y + 1) return 'up';
    if (to.y === from.y - 1) return 'down';
    return null;
}