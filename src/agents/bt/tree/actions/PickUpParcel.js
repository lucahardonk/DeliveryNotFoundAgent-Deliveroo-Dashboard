import { stepAlongPath } from './MoveToTarget.js';

/**
 * Pickup actions.
 *
 * @typedef {import("../../BtBlackboard.js").BtBlackboard} BtBlackboard
 */

/**
 * Picks up the parcel on the current tile and clears the queued path
 * (the pickup goal has been reached).
 * @param {BtBlackboard} bb
 * @returns {Promise<void>}
 */
export async function pickUpHere(bb) {
    await bb.ctx.client.pickup();
    bb.actions.length = 0;
}

/**
 * Navigates to and picks up the closest sensed parcel:
 *   - if standing on a parcel tile, pick it up and clear the path;
 *   - else if a path to a parcel tile is active, take the next step;
 *   - else plan a path to the closest reachable parcel.
 * @param {BtBlackboard} bb
 * @returns {Promise<void>}
 */
export async function pickupClosestParcel(bb) {
    if (bb.isOnParcelTile()) {
        await bb.ctx.client.pickup();
        // Reaching a parcel tile that wasn't the planned destination still
        // fulfils the pickup goal, so clear the remaining moves.
        bb.actions.length = 0;
    } else if (bb.hasNavigationPath(dest => bb.destinationIsParcelTile(dest))) {
        await stepAlongPath(bb);
    } else {
        const navigationPath = await bb.getPathToClosestTargetTiles(
            bb.ctx.perception.sensedParcels.map(parcel => ({ x: parcel.x, y: parcel.y }))
        );
        console.log('Navigation path to closest parcel planned:');
        console.dir(navigationPath, { depth: null });
        bb.loadIntentionActions(navigationPath);
    }
}
