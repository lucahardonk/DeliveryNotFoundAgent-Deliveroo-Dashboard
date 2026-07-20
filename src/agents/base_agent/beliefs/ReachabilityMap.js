import { StronglyConnectedComponents } from '../navigation/StronglyConnectedComponents.js';

/**
 * Reachability belief derived from the static map.
 *
 * Wraps the SCC matrix produced by {@link StronglyConnectedComponents}: two
 * tiles are mutually reachable iff they belong to the same strongly connected
 * component. Recomputed once whenever the map changes.
 *
 * @typedef {import("../domain/Position.js").TilePosition} TilePosition
 */
export class ReachabilityMap {
    /** @type {number[][]} */
    sccMap = [];

    #analysis = new StronglyConnectedComponents();

    /**
     * (Re)computes the SCC matrix from the given map.
     * @param {{width:number,height:number,tiles:any[][]}} map
     * @returns {number[][]}
     */
    compute(map) {
        this.sccMap = this.#analysis.stronglyConnectedComponents(map);
        return this.sccMap;
    }

    /**
     * @param {TilePosition} a
     * @param {TilePosition} b
     * @returns {boolean} true when `a` and `b` are in the same SCC (mutually reachable).
     */
    sameComponent(a, b) {
        return this.sccMap[a.x][a.y] === this.sccMap[b.x][b.y];
    }

    /**
     * Filters `tiles` down to those reachable from `from`.
     * @param {TilePosition} from
     * @param {TilePosition[]} tiles
     * @returns {TilePosition[]}
     */
    filterReachable(from, tiles) {
        return tiles.filter(tile => this.sameComponent(from, tile));
    }
}
