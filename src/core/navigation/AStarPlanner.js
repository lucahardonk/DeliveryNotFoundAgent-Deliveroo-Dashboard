import { MinPriorityQueue } from '@datastructures-js/priority-queue';
import { getNeighbors } from '../world/MapModel.js';
import { reconstructPath } from './Path.js';

/**
 * @typedef {import("../domain/Position.js").TilePosition} TilePosition
 * @typedef {import("./Path.js").NavigationPath} NavigationPath
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOAgent.js").IOAgent} IOAgent
 */

/**
 * @callback HeuristicFunction
 * @param {TilePosition} startTile
 * @param {TilePosition} targetTile
 * @returns {number}
 */

const COST_TO_NEIGHBOR = 1;

/**
 * Shortest-path planner for the grid world.
 *
 * Implements A* plus a small family of admissible heuristics (Manhattan,
 * diagonal, Euclidean). Path reconstruction lives in {@link Path.js} and the
 * neighbour expansion (walls / one-way tiles / occupied tiles) lives in
 * {@link MapModel.js}, keeping this class focused on the search itself.
 */
export class AStarPlanner {

    // ── Heuristics ──────────────────────────────────────────────────────────

    /** @param {TilePosition} startTile @param {TilePosition} targetTile @returns {number} */
    manhattanDistance(startTile, targetTile) {
        return Math.abs(startTile.x - targetTile.x) + Math.abs(startTile.y - targetTile.y);
    }

    /** @param {TilePosition} startTile @param {TilePosition} targetTile @returns {number} */
    diagonalDistance(startTile, targetTile) {
        return Math.max(Math.abs(startTile.x - targetTile.x), Math.abs(startTile.y - targetTile.y));
    }

    /** @param {TilePosition} startTile @param {TilePosition} targetTile @returns {number} */
    euclideanDistance(startTile, targetTile) {
        return Math.sqrt(Math.pow(startTile.x - targetTile.x, 2) + Math.pow(startTile.y - targetTile.y, 2));
    }

    // ── Search ───────────────────────────────────────────────────────────────

    /**
     * A* search from `startTile` to `targetTile`.
     *
     * @param {{width:number,height:number,tiles:any[][]}} map
     * @param {TilePosition} startTile
     * @param {TilePosition} targetTile
     * @param {IOAgent[]} [sensedAgents] - if provided, occupied tiles are avoided.
     * @param {HeuristicFunction} [heuristic] - defaults to Manhattan distance.
     * @returns {NavigationPath | null} the route and total distance, or null if unreachable.
     */
    aStar(map, startTile, targetTile, sensedAgents, heuristic = this.manhattanDistance) {
        const minQueue = new MinPriorityQueue((tileScore) => tileScore.distance, [{ tile: startTile, distance: 0 }]);
        const cameFrom  = Array.from({ length: map.width }, () => new Array(map.height).fill(null));
        const costScore = Array.from({ length: map.width }, () => new Array(map.height).fill(Infinity));
        const fScore    = Array.from({ length: map.width }, () => new Array(map.height).fill(Infinity));

        costScore[startTile.x][startTile.y] = 0;
        fScore[startTile.x][startTile.y] = heuristic(startTile, targetTile);

        while (!minQueue.isEmpty()) {
            const { tile: currentTile, distance: dequeuedDistance } = minQueue.dequeue();

            // stale entry: a better path to this tile was already processed
            if (dequeuedDistance > + fScore[currentTile.x][currentTile.y]) continue;

            if (currentTile.x === targetTile.x && currentTile.y === targetTile.y) {
                return reconstructPath(cameFrom, currentTile);
            }

            for (const neighborTile of getNeighbors(map, currentTile, sensedAgents)) {
                const tentativeCostScore = costScore[currentTile.x][currentTile.y] + COST_TO_NEIGHBOR;

                if (tentativeCostScore < costScore[neighborTile.x][neighborTile.y]) {
                    cameFrom[neighborTile.x][neighborTile.y] = currentTile;
                    costScore[neighborTile.x][neighborTile.y] = tentativeCostScore;
                    fScore[neighborTile.x][neighborTile.y] = tentativeCostScore + heuristic(neighborTile, targetTile);
                    minQueue.enqueue({ tile: neighborTile, distance: fScore[neighborTile.x][neighborTile.y] });
                }
            }
        }

        return null;
    }
}
