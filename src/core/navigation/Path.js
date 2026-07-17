/**
 * Path representation and reconstruction helpers, shared by every planner.
 *
 * @typedef {import("../domain/Position.js").TilePosition} TilePosition
 * @typedef {import("../domain/Position.js").MoveDirection} MoveDirection
 */

/**
 * A single step of a route: leave `from`, move in `direction`, arrive at `to`.
 * @typedef {Object} TileMoveTile
 * @property {TilePosition} from
 * @property {MoveDirection} direction
 * @property {TilePosition} to
 */

/**
 * A full navigation route plus its length in steps.
 * @typedef {Object} NavigationPath
 * @property {number} distance
 * @property {TileMoveTile[]} path
 */

/**
 * Returns the move direction to go from `currentTile` to `nextTile`, or null if
 * they are not orthogonally adjacent.
 *
 * @param {TilePosition} currentTile
 * @param {TilePosition} nextTile
 * @param {boolean} [reverse=false] - when true, computes the direction from
 *   `nextTile` to `currentTile` (used during path reconstruction).
 * @returns {MoveDirection | null}
 */
export function whichMoveDirection(currentTile, nextTile, reverse = false) {
    if (reverse) {
        [currentTile, nextTile] = [nextTile, currentTile];
    }

    if (currentTile.x === nextTile.x && currentTile.y < nextTile.y) return 'up';
    if (currentTile.x === nextTile.x && currentTile.y > nextTile.y) return 'down';
    if (currentTile.x < nextTile.x && currentTile.y === nextTile.y) return 'right';
    if (currentTile.x > nextTile.x && currentTile.y === nextTile.y) return 'left';

    return null;
}

/**
 * Rebuilds the route from a `cameFrom` predecessor matrix produced by a search
 * algorithm, walking backwards from the target and reversing the result.
 *
 * @param {TilePosition[][]} cameFrom
 * @param {TilePosition} currentTile - the target tile the search reached.
 * @returns {NavigationPath}
 */
export function reconstructPath(cameFrom, currentTile) {
    const navigationPath = { distance: 0, path: [] };
    let srcTile;

    while (cameFrom[currentTile.x][currentTile.y] !== null) {
        srcTile = cameFrom[currentTile.x][currentTile.y];
        const direction = whichMoveDirection(currentTile, srcTile, true);

        const tileMoveTile = { from: srcTile, direction, to: currentTile };
        navigationPath.path.push(tileMoveTile);

        currentTile = srcTile;
        navigationPath.distance++;
    }

    // reverse to get the correct order from start to target
    navigationPath.path = navigationPath.path.reverse();

    return navigationPath;
}

/** An empty (unreachable) navigation result. */
export function emptyPath() {
    return { distance: Infinity, path: [] };
}
