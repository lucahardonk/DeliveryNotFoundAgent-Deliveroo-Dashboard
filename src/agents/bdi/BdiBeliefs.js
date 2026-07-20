import { TILE_TYPES } from '../common/domain/Tile.js';

/**
 * Read-only belief queries for the BDI agent.
 *
 * These are the small predicate helpers that plan `context()` / `body()`
 * functions ask questions with (do I carry a parcel? am I on a delivery tile?
 * does my current path end on a delivery tile?). They were private methods on
 * the monolithic `BDI_Agent_2`; here they read from the shared
 * {@link AgentContext} plus the live {@link IntentionQueue}.
 *
 * @typedef {import("../common/AgentContext.js").AgentContext} AgentContext
 * @typedef {import("./IntentionQueue.js").IntentionQueue} IntentionQueue
 * @typedef {import("../common/domain/Position.js").TilePosition} TilePosition
 */
export class BdiBeliefs {
    /**
     * @param {AgentContext} ctx
     * @param {IntentionQueue} queue - the agent's live intention queue.
     */
    constructor(ctx, queue) {
        this.ctx = ctx;
        this.queue = queue;
    }

    /** @returns {boolean} true when the agent is currently carrying a parcel. */
    hasParcel() {
        return this.ctx.perception.sensedParcels.some(p => p.carriedBy === this.ctx.me.id);
    }

    /** @returns {boolean} true when the agent stands on a delivery tile. */
    isOnDeliveryTile() {
        const me = this.ctx.me;
        return this.ctx.map.tiles[me.x][me.y] === TILE_TYPES.delivery;
    }

    /** @returns {boolean} true when a sensed parcel lies on the agent's tile. */
    isOnParcelTile() {
        const me = this.ctx.me;
        return this.ctx.perception.sensedParcels.some(p => p.x === me.x && p.y === me.y);
    }

    /** @returns {boolean} true when at least one delivery tile is reachable. */
    deliveryTilesReachable() {
        const me = this.ctx.me;
        return this.ctx.map.deliveryTiles.some(t => this.ctx.reachability.sameComponent(me, t));
    }

    /**
     * Whether the current navigation path ends on a tile satisfying `predicate`.
     * @param {(dest: TilePosition) => boolean} predicate
     * @returns {boolean}
     */
    hasNavigationPath(predicate) {
        if (this.queue.length > 0) {
            return predicate(this.queue.at(-1).to);
        }
        return false;
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
}
