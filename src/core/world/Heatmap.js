/**
 * Cumulative parcel-sighting heatmap: a `width x height` matrix of counters,
 * incremented every time a parcel is sensed on a tile. Used by the dashboard to
 * visualise where parcels tend to appear.
 *
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOParcel.js").IOParcel} IOParcel
 */
export class Heatmap {
    /** @type {number[][]} */
    matrix = [];

    /**
     * Allocates a zeroed `width x height` matrix.
     * @param {number} width
     * @param {number} height
     */
    init(width, height) {
        this.matrix = Array.from({ length: width }, () => new Array(height).fill(0));
    }

    /**
     * Increments the counter for every tile currently holding a sensed parcel.
     * @param {IOParcel[]} parcels
     */
    increment(parcels) {
        for (const parcel of parcels) {
            if (this.matrix[parcel.x]?.[parcel.y] !== undefined) {
                this.matrix[parcel.x][parcel.y]++;
            }
        }
    }
}
