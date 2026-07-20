import { TILE_TYPES } from '../base_agent/domain/Tile.js';
import { carriedParcelsValueAfterSteps, carriedParcelsValueWithDeviation } from '../base_agent/domain/Parcel.js';

/**
 * Shared working memory for the behaviour tree.
 *
 * Holds the queued moves (`actions`) plus every belief query and navigation
 * helper the tree's conditions and actions need. All methods here are faithful
 * ports of the original monolithic `BT_Agent` private methods, now reading from
 * the shared {@link AgentContext} instead of private class fields.
 *
 * @typedef {import("../base_agent/AgentContext.js").AgentContext} AgentContext
 * @typedef {import("../base_agent/navigation/Path.js").NavigationPath} NavigationPath
 * @typedef {import("../base_agent/navigation/Path.js").TileMoveTile} TileMoveTile
 * @typedef {import("../base_agent/domain/Position.js").TilePosition} TilePosition
 */
export class BtBlackboard {
    /** @param {AgentContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        /** @type {TileMoveTile[]} — the currently queued moves. */
        this.actions = [];
        /** @type {boolean} — whether the last attempted move failed. */
        this._moveFailed = false;
    }

    // ── Action / move-failure flag helpers ─────────────────────────────────

    /** Clears every queued move. */
    clearActions() { this.actions.length = 0; }

    /** Marks that the last attempted move failed. */
    flagMoveFailed() { this._moveFailed = true; }

    /** Resets the move-failed flag (called at the top of each BT tick). */
    resetMoveFailedFlag() { this._moveFailed = false; }

    /** @returns {boolean} whether the last attempted move failed. */
    get lastMoveFailed() { return this._moveFailed; }

    // ── Belief queries ──────────────────────────────────────────────────────

    /** @returns {TilePosition} the agent's current tile. */
    get position() {
        return { x: this.ctx.me.x, y: this.ctx.me.y };
    }

    /** @returns {boolean} */
    isOnDeliveryTile() {
        return this.ctx.map.tiles[this.ctx.me.x][this.ctx.me.y] === TILE_TYPES.delivery;
    }

    /** @returns {boolean} */
    isOnParcelTile() {
        return this.ctx.perception.sensedParcels.some(
            parcel => parcel.x === this.ctx.me.x && parcel.y === this.ctx.me.y && parcel.carriedBy == null
        );
    }

    /** @param {TilePosition} dest @returns {boolean} */
    destinationIsDeliveryTile(dest) {
        return this.ctx.map.tiles[dest.x][dest.y] === TILE_TYPES.delivery;
    }

    /** @param {TilePosition} dest @returns {boolean} */
    destinationIsParcelTile(dest) {
        return this.ctx.perception.sensedParcels.some(p => p.x === dest.x && p.y === dest.y);
    }

    /** @param {TilePosition} dest @returns {boolean} */
    destinationIsValidTile(dest) {
        const type = this.ctx.map.tiles[dest.x]?.[dest.y];
        return type !== null && type !== TILE_TYPES.wall;
    }

    /**
     * @param {(destination: TilePosition) => boolean} predicate
     * @returns {boolean} whether the current path ends at a tile matching `predicate`.
     */
    hasNavigationPath(predicate) {
        if (this.actions.length > 0) {
            const destinationTile = this.actions.at(-1).to;
            return predicate(destinationTile);
        }
        return false;
    }

    /** @returns {boolean} whether the agent is currently carrying a parcel. */
    hasParcel() {
        return this.ctx.perception.sensedParcels.some(parcel => parcel.carriedBy === this.ctx.me.id);
    }

    /** @returns {boolean} whether any free (uncarried) parcel is currently sensed. */
    detectsFreeParcelsNearby() {
        let freeParcels = false;
        this.ctx.perception.sensedParcels.forEach(parcel => { if (parcel.carriedBy == null) freeParcels = true; });
        return freeParcels;
    }

    // ── Reward projections ──────────────────────────────────────────────────

    /**
     * Projected total reward of carried parcels after `steps` moves.
     * @param {number} [steps=0]
     * @returns {number}
     */
    carriedParcelsValueAfterSteps(steps = 0) {
        return carriedParcelsValueAfterSteps(
            this.ctx.perception.sensedParcels,
            this.ctx.me.id,
            steps,
            { clock: this.ctx.config.clock, decayInterval: this.ctx.config.decayInterval }
        );
    }

    /**
     * Projected reward if we detour to pick up `candidateParcel` before delivering.
     * @param {number} stepsToParcel
     * @param {number} stepsToDelivery
     * @param {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOParcel.js").IOParcel} candidateParcel
     * @returns {number}
     */
    carriedParcelsValueWithDeviation(stepsToParcel, stepsToDelivery, candidateParcel) {
        return carriedParcelsValueWithDeviation(
            this.ctx.perception.sensedParcels,
            this.ctx.me.id,
            stepsToParcel,
            stepsToDelivery,
            candidateParcel,
            { clock: this.ctx.config.clock, decayInterval: this.ctx.config.decayInterval }
        );
    }

    // ── Navigation ──────────────────────────────────────────────────────────

    /**
     * Shortest path to the closest reachable tile among `targetTiles`
     * (only tiles in the same SCC as `startTile` are considered).
     * @param {TilePosition[]} targetTiles
     * @param {TilePosition} [startTile]
     * @returns {Promise<NavigationPath>}
     */
    async getPathToClosestTargetTiles(targetTiles, startTile = { x: this.ctx.me.x, y: this.ctx.me.y }) {
        const eligibleTiles = targetTiles.filter(tile => this.ctx.reachability.sameComponent(startTile, tile));

        const paths = await Promise.all(
            eligibleTiles.map(tile =>
                Promise.resolve(this.ctx.planner.aStar(this.ctx.map, startTile, { x: tile.x, y: tile.y }))
            )
        );

        return paths
            .filter(path => path !== null)
            .reduce(
                (shortest, path) => path.distance < shortest.distance ? path : shortest,
                { distance: Infinity, path: [] }
            );
    }

    /**
     * Replaces the queued moves with the steps of `navigationPath`.
     * Old moves are erased first to keep the intention consistent with the
     * latest beliefs.
     * @param {NavigationPath} navigationPath
     */
    loadIntentionActions(navigationPath) {
        this.actions.length = 0;
        for (const step of navigationPath.path) {
            this.actions.push(step);
        }
    }

    /**
     * Retry-aware single move (delegates to the shared movement executor).
     * @param {import("../base_agent/domain/Position.js").MoveDirection} direction
     * @param {number} [maxAttempts=3]
     * @returns {Promise<object|null>}
     */
    resilientMove(direction, maxAttempts = 3) {
        return this.ctx.movement.resilientMove(direction, maxAttempts);
    }
}
