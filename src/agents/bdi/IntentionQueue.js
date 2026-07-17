/**
 * The BDI agent's intention as an executable queue of moves, plus the planning
 * helpers that populate it.
 *
 * Ported from the monolithic `BDI_Agent_2` navigation helpers
 * (`#getPathToClosestTargetTiles`, `#loadIntentionActions`, `#stepAlongPath`),
 * now reading from the shared {@link AgentContext}.
 *
 * @typedef {import("../common/AgentContext.js").AgentContext} AgentContext
 * @typedef {import("../../core/navigation/Path.js").NavigationPath} NavigationPath
 * @typedef {import("../../core/navigation/Path.js").TileMoveTile} TileMoveTile
 * @typedef {import("../../core/domain/Position.js").TilePosition} TilePosition
 */
export class IntentionQueue {
    /** @param {AgentContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        /** @type {TileMoveTile[]} */
        this.actions = [];
    }

    /** @returns {number} number of queued moves. */
    get length() {
        return this.actions.length;
    }

    /** @param {number} i @returns {TileMoveTile} */
    at(i) {
        return this.actions.at(i);
    }

    /** Removes and returns the next move. */
    shift() {
        return this.actions.shift();
    }

    /** Empties the queue. */
    clear() {
        this.actions.length = 0;
    }

    /**
     * Replaces the queue with the steps of `navigationPath`.
     * @param {NavigationPath} navigationPath
     */
    load(navigationPath) {
        this.actions.length = 0;
        for (const step of navigationPath.path) {
            this.actions.push(step);
        }
    }

    /**
     * Shortest path to the closest reachable tile among `targetTiles`
     * (only tiles in the same SCC as the agent are considered).
     * @param {TilePosition[]} targetTiles
     * @returns {Promise<NavigationPath>}
     */
    async getPathToClosestTargetTiles(targetTiles) {
        const startTile = { x: this.ctx.me.x, y: this.ctx.me.y };

        const eligibleTiles = targetTiles.filter(tile => this.ctx.reachability.sameComponent(startTile, tile));

        const paths = await Promise.all(
            eligibleTiles.map(tile =>
                Promise.resolve(this.ctx.planner.aStar(this.ctx.map, startTile, { x: tile.x, y: tile.y }))
            )
        );

        return paths
            .filter(p => p !== null)
            .reduce(
                (shortest, p) => p.distance < shortest.distance ? p : shortest,
                { distance: Infinity, path: [] }
            );
    }

    /**
     * Executes the next queued move; clears the queue on failure.
     * @returns {Promise<void>}
     */
    async stepAlongPath() {
        const nextMove = this.shift();
        const success = await this.ctx.movement.resilientMove(nextMove.direction);
        if (!success) {
            console.error('[Nav] Move failed — clearing path.');
            this.clear();
        }
    }
}
