/**
 * Movement actions: consume the next queued step, or (when no path is active)
 * plan a fresh exploration route toward a random parcel-spawner tile.
 *
 * @typedef {import("../../BtBlackboard.js").BtBlackboard} BtBlackboard
 */

/**
 * Executes the next queued move. Clears the remaining plan on failure so the
 * tree re-plans on the following tick.
 * @param {BtBlackboard} bb
 * @returns {Promise<boolean>} true if the move succeeded.
 */
export async function stepAlongPath(bb) {
    const nextMove = bb.actions.shift();
    const success = await bb.resilientMove(nextMove.direction);

    if (!success) {
        console.error('Move failed, aborting current navigation path');
        bb.actions.length = 0; // clear remaining planned moves
        bb.flagMoveFailed();
    }

    return Boolean(success);
}

/**
 * Explore the map: either continue along the current valid path, or plan a
 * route to a random parcel-spawner tile.
 * @param {BtBlackboard} bb
 * @returns {Promise<void>}
 */
export async function randomlyExploreMap(bb) {
    if (bb.hasNavigationPath(dest => bb.destinationIsValidTile(dest))) {
        await stepAlongPath(bb);
    } else {
        const spawnerTiles = bb.ctx.map.parcelSpawnerTiles;
        const randomSpawnerTile = spawnerTiles[Math.floor(Math.random() * spawnerTiles.length)];
        const navigationPath = await bb.ctx.planner.aStar(
            bb.ctx.map,
            { x: bb.ctx.me.x, y: bb.ctx.me.y },
            randomSpawnerTile,
            bb.ctx.perception.sensedAgents
        );
        // console.log('Random exploration path planned:');
        // console.dir(navigationPath, { depth: null });
        bb.loadIntentionActions(navigationPath);
    }
}
