import { TILE_TYPES } from '../domain/Tile.js';
import { getNeighbors } from '../world/MapModel.js';

/**
 * @typedef {import("../domain/Position.js").TilePosition} TilePosition
 */

const NOT_VISITED = -1;

/**
 * Computes the strongly connected components (SCCs) of the map using Tarjan's
 * algorithm.
 *
 * An SCC is a maximal set of tiles such that every tile is reachable from every
 * other tile. Directional (one-way) tiles make the map a directed graph, so two
 * tiles can share an SCC only if there is a directed path between them in both
 * directions. The result is used to decide which target tiles are actually
 * reachable from the agent's current position.
 */
export class StronglyConnectedComponents {

    /**
     * @param {{width:number,height:number,tiles:any[][]}} map
     * @returns {number[][]} 2D matrix where each cell holds the component id of
     *   that tile, or -1 for walls / non-walkable tiles. Tiles in the same SCC
     *   share the same id.
     */
    stronglyConnectedComponents(map) {
        const disc        = Array.from({ length: map.width }, () => new Array(map.height).fill(NOT_VISITED));
        const low         = Array.from({ length: map.width }, () => new Array(map.height).fill(0));
        const onStack     = Array.from({ length: map.width }, () => new Array(map.height).fill(false));
        const componentId = Array.from({ length: map.width }, () => new Array(map.height).fill(-1));

        const stack = [];
        let timer = 0;
        let componentCount = 0;

        const dfs = (tile) => {
            disc[tile.x][tile.y] = low[tile.x][tile.y] = timer++;
            stack.push(tile);
            onStack[tile.x][tile.y] = true;

            for (const neighbor of getNeighbors(map, tile)) {
                if (disc[neighbor.x][neighbor.y] === NOT_VISITED) {
                    dfs(neighbor);
                    low[tile.x][tile.y] = Math.min(low[tile.x][tile.y], low[neighbor.x][neighbor.y]);
                } else if (onStack[neighbor.x][neighbor.y]) {
                    // neighbor is in the current DFS path: back edge
                    low[tile.x][tile.y] = Math.min(low[tile.x][tile.y], disc[neighbor.x][neighbor.y]);
                }
            }

            // tile is the root of a completed SCC: pop the stack until we reach it
            if (low[tile.x][tile.y] === disc[tile.x][tile.y]) {
                let w;
                do {
                    w = stack.pop();
                    onStack[w.x][w.y] = false;
                    componentId[w.x][w.y] = componentCount;
                } while (w.x !== tile.x || w.y !== tile.y);
                componentCount++;
            }
        };

        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const isWalkable = map.tiles[x][y] !== null && map.tiles[x][y] !== TILE_TYPES.wall;
                if (isWalkable && disc[x][y] === NOT_VISITED) {
                    dfs({ x, y });
                }
            }
        }

        return componentId;
    }
}
