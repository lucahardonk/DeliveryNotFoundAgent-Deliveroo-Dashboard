import { MapModel } from './MapModel.js';

/**
 * Aggregate of the two spatial belief layers:
 *   - {@link MapModel} `map`  — the static tile grid (walls, delivery, spawners)
 *   - `sensed`                — a parallel grid tracking the last time each tile
 *                               was within sensing range (`updateTime`).
 *
 * Both layers are (re)built together from the server `map` event so they always
 * share the same dimensions.
 *
 * @typedef {import("../domain/Position.js").TilePosition} TilePosition
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOTile.js").IOTile} IOTile
 *
 * @typedef {Object} SensedTile
 * @property {number} updateTime
 *
 * @typedef {Object} SensedWorld
 * @property {number} width
 * @property {number} height
 * @property {SensedTile[][]} tiles
 */
export class WorldState {
    constructor() {
        /** @type {MapModel} */
        this.map = new MapModel();
        /** @type {SensedWorld} */
        this.sensed = { width: 0, height: 0, tiles: [] };
    }

    /**
     * Builds the static map and the parallel sensing grid from the raw tiles of
     * the server `map` event.
     * @param {IOTile[]} tiles
     */
    buildFromTiles(tiles) {
        this.map.buildFromTiles(tiles);

        this.sensed.width = this.map.width;
        this.sensed.height = this.map.height;
        this.sensed.tiles = Array.from(
            { length: this.sensed.width },
            () => new Array(this.sensed.height).fill(null)
        );

        for (const tile of tiles) {
            this.sensed.tiles[tile.x][tile.y] = { updateTime: 0 };
        }
    }

    /**
     * Marks a set of sensed tile positions as observed at `time`.
     * @param {TilePosition[]} positions
     * @param {number} time
     */
    markSensed(positions, time) {
        for (const position of positions) {
            this.sensed.tiles[position.x][position.y].updateTime = time;
        }
    }
}
