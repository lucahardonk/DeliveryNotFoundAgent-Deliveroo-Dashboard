export const TILE = { wall: '0', spawner: '1', delivery: '2', walkable: '3' };

/**
 * Parses the raw tile list from the server `map` event into a usable model.
 * @param {Array<{x:number, y:number, type:string|number}>} rawTiles
 * @returns {{ width, height, tiles, deliveryTiles, spawnerTiles, walkableTiles: {x:number,y:number}[] }}
 */
export function buildMap(rawTiles) {
    let width = 0, height = 0;
    for (const t of rawTiles) {
        if (t.x > width)  width  = t.x;
        if (t.y > height) height = t.y;
    }
    width++; height++;

    const tiles         = Array.from({ length: width }, () => new Array(height).fill(null));
    const deliveryTiles = [];
    const spawnerTiles  = [];
    const walkableTiles = [];

    for (const t of rawTiles) {
        const type = String(t.type);
        tiles[t.x][t.y] = type;
        if (type === TILE.delivery) deliveryTiles.push({ x: t.x, y: t.y });
        if (type === TILE.spawner)  spawnerTiles.push({ x: t.x, y: t.y });
        if (type !== TILE.wall)     walkableTiles.push({ x: t.x, y: t.y });
    }

    return { width, height, tiles, deliveryTiles, spawnerTiles, walkableTiles };
}

/** True if (x,y) is within bounds and not a wall. */
export function isWalkable(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const type = map.tiles[x]?.[y];
    return type != null && type !== TILE.wall;
}

// One-way tiles: entering is unrestricted, but there is exactly ONE legal
// exit direction — confirmed empirically (server logs, 2026-08-06): from a
// '←' tile, both 'left' (the naive "matches the arrow" reading) and 'down'
// (perpendicular) were rejected by the server, leaving only 'right' — the
// OPPOSITE of the visual arrow. So the visual arrow indicates the direction
// flow enters FROM, not the direction of legal travel; the one legal exit is
// the reverse of the arrow shown. 'up'/'down' here follow this codebase's
// existing convention (Pathfinding.js neighbors()) where 'up' is y+1, not
// screen-up.
/** @type {Record<string,string>} */
const ARROW_DIR = { '↑': 'up', '↓': 'down', '→': 'right', '←': 'left' };
/** @type {Record<string,string>} */
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * The single direction an agent is allowed to leave (x,y) through (the
 * reverse of a one-way tile's visual arrow), or null if unconstrained.
 * @param {{tiles:string[][]}} map
 * @param {number} x
 * @param {number} y
 */
export function allowedExitDirection(map, x, y) {
    const dir = ARROW_DIR[map.tiles[x]?.[y]];
    return dir ? OPPOSITE[dir] : null;
}