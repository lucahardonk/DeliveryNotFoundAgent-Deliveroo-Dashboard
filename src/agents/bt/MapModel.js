export const TILE = { wall: '0', spawner: '1', delivery: '2', walkable: '3' };

/**
 * Parses the raw tile list from the server `map` event into a usable model.
 * @param {Array<{x:number, y:number, type:string|number}>} rawTiles
 * @returns {{ width, height, tiles, deliveryTiles, spawnerTiles }}
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

    for (const t of rawTiles) {
        const type = String(t.type);
        tiles[t.x][t.y] = type;
        if (type === TILE.delivery) deliveryTiles.push({ x: t.x, y: t.y });
        if (type === TILE.spawner)  spawnerTiles.push({ x: t.x, y: t.y });
    }

    return { width, height, tiles, deliveryTiles, spawnerTiles };
}

/** True if (x,y) is within bounds and not a wall. */
export function isWalkable(map, x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const type = map.tiles[x]?.[y];
    return type != null && type !== TILE.wall;
}