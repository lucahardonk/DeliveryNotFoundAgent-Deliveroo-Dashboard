/**
 * A tile position on the grid.
 *
 * @typedef {Object} TilePosition
 * @property {number} x
 * @property {number} y
 */

/**
 * Absolute movement directions on the grid.
 * @typedef {"up" | "right" | "left" | "down"} MoveDirection
 */

/**
 * Returns true if two positions refer to the same tile.
 * @param {TilePosition} a
 * @param {TilePosition} b
 * @returns {boolean}
 */
export function samePosition(a, b) {
    return a.x === b.x && a.y === b.y;
}

/**
 * Manhattan (L1) distance between two positions.
 * @param {TilePosition} a
 * @param {TilePosition} b
 * @returns {number}
 */
export function manhattanDistance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Stable string key for a position, handy for use in Maps/Sets.
 * @param {TilePosition} p
 * @returns {string}
 */
export function positionKey(p) {
    return `${p.x},${p.y}`;
}
