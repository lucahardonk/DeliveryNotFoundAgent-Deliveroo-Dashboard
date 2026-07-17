/**
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOTile.js").IOTile} IOTile
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOTileType.js").IOTileType} IOTileType
 */

/**
 * Canonical tile-type codes used across the whole platform.
 *
 * The Deliveroo server reports tile types as strings/numbers; these constants
 * give them meaningful names so the rest of the code never has to hard-code the
 * raw values.
 */
export const TILE_TYPES = {
    wall: '0',
    parcelSpawner: '1',
    delivery: '2',
    walkable: '3',
    crateSliding: '5',
    crateSpawning: '5!',

    directional: {
        left: '←',
        right: '→',
        up: '↑',
        down: '↓',
    },
};

/**
 * @param {IOTileType} tileType
 * @returns {boolean}
 */
export function isWall(tileType) {
    return tileType === TILE_TYPES.wall;
}

/**
 * A tile is walkable if it exists (not null / off-map) and is not a wall.
 * @param {IOTileType} tileType
 * @returns {boolean}
 */
export function isWalkable(tileType) {
    return tileType !== null && tileType !== undefined && tileType !== TILE_TYPES.wall;
}

/**
 * @param {IOTileType} tileType
 * @returns {boolean}
 */
export function isDelivery(tileType) {
    return tileType === TILE_TYPES.delivery;
}

/**
 * @param {IOTileType} tileType
 * @returns {boolean}
 */
export function isParcelSpawner(tileType) {
    return tileType === TILE_TYPES.parcelSpawner;
}
