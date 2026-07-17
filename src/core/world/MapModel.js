import { TILE_TYPES } from '../domain/Tile.js';

/**
 * Static model of the game map: dimensions, the 2D tile-type grid, and the
 * precomputed lists of delivery / parcel-spawner tiles. Instances are shaped
 * as `{ width, height, tiles }` so they can be passed directly to the planners
 * (and serialised to the dashboard).
 *
 * @typedef {import("../domain/Position.js").TilePosition} TilePosition
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOTile.js").IOTile} IOTile
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOAgent.js").IOAgent} IOAgent
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOTileType.js").IOTileType} IOTileType
 */

/**
 * Returns the walkable orthogonal neighbours of a tile, respecting walls,
 * one-way (directional) tiles, crate-spawning tiles and — optionally — tiles
 * currently occupied by other agents.
 *
 * @param {{width:number,height:number,tiles:IOTileType[][]}} map
 * @param {TilePosition} tile
 * @param {IOAgent[]|null} [sensedAgents=null] - if provided, occupied tiles are skipped.
 * @param {boolean} [crateSpawningFriend=false] - treat crate-spawning tiles as walkable.
 * @returns {TilePosition[]}
 */
export function getNeighbors(map, tile, sensedAgents = null, crateSpawningFriend = false) {
    const neighbors = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if ((dx === 0 && dy === 0) || Math.abs(dx) + Math.abs(dy) === 2) continue; // skip self and diagonals

            const neighborX = tile.x + dx;
            const neighborY = tile.y + dy;

            if (neighborX < 0 || neighborX >= map.width || neighborY < 0 || neighborY >= map.height) continue;

            const neighborTileType = map.tiles[neighborX][neighborY];

            if (neighborTileType === TILE_TYPES.wall) continue;
            if (neighborTileType === TILE_TYPES.directional.up    && dy === -1) continue; // current tile is above a one-way-up cell
            if (neighborTileType === TILE_TYPES.directional.right && dx === -1) continue; // current tile is right of a one-way-right cell
            if (neighborTileType === TILE_TYPES.directional.down  && dy ===  1) continue; // current tile is below a one-way-down cell
            if (neighborTileType === TILE_TYPES.directional.left  && dx ===  1) continue; // current tile is left of a one-way-left cell

            if (!crateSpawningFriend && neighborTileType === TILE_TYPES.crateSpawning) continue;

            if (sensedAgents && !freeTile(neighborX, neighborY, sensedAgents)) {
                console.log(`Tile (${neighborX}, ${neighborY}) is occupied by another agent, skipping it as a neighbor.`);
                continue;
            }

            neighbors.push({ x: neighborX, y: neighborY });
        }
    }

    return neighbors;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {IOAgent[]} sensing
 * @returns {boolean} true when no sensed agent occupies (x, y).
 */
function freeTile(x, y, sensing) {
    console.log(`freeTile (${x}, ${y}, ${sensing})`);
    return !sensing.some(agent => agent.x === x && agent.y === y);
}

export class MapModel {
    /** @type {number} */
    width = 0;
    /** @type {number} */
    height = 0;
    /** @type {IOTileType[][]} */
    tiles = [];

    /** @type {IOTile[]} */
    deliveryTiles = [];
    /** @type {IOTile[]} */
    parcelSpawnerTiles = [];

    /**
     * Builds the tile grid from the raw list of tiles emitted by the server
     * `map` event, deriving true width/height from the tile coordinates
     * (the reported width/height can be wrong) and indexing the delivery and
     * spawner tiles.
     * @param {IOTile[]} tiles
     */
    buildFromTiles(tiles) {
        // XXX: server bug — reported width/height may be incorrect, derive from tile positions
        for (const tile of tiles) {
            if (tile.x > this.width)  this.width  = tile.x;
            if (tile.y > this.height) this.height = tile.y;
        }
        this.width++;
        this.height++;

        this.tiles = Array.from(
            { length: this.width },
            () => new Array(this.height).fill(null)
        );

        this.deliveryTiles = [];
        this.parcelSpawnerTiles = [];

        for (const tile of tiles) {
            const tileType = String(tile.type);
            this.tiles[tile.x][tile.y] = tileType;

            switch (tileType) {
                case TILE_TYPES.parcelSpawner: this.parcelSpawnerTiles.push(tile); break;
                case TILE_TYPES.delivery:      this.deliveryTiles.push(tile);      break;
            }
        }
    }

    /**
     * @param {TilePosition} tile
     * @param {IOAgent[]|null} [sensedAgents=null]
     * @param {boolean} [crateSpawningFriend=false]
     * @returns {TilePosition[]}
     */
    getNeighbors(tile, sensedAgents = null, crateSpawningFriend = false) {
        return getNeighbors(this, tile, sensedAgents, crateSpawningFriend);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isWalkable(x, y) {
        const type = this.tiles[x]?.[y];
        return type !== null && type !== undefined && type !== TILE_TYPES.wall;
    }
}
