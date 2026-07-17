import { stepAlongPath } from './MoveToTarget.js';

/**
 * Delivery action.
 *
 * @typedef {import("../../BtBlackboard.js").BtBlackboard} BtBlackboard
 */

/**
 * Delivers carried parcels:
 *   - if standing on a delivery tile, put them down;
 *   - else if a path to a delivery tile is active, take the next step;
 *   - else plan a path to the closest reachable delivery tile.
 * @param {BtBlackboard} bb
 * @returns {Promise<void>}
 */
export async function deliverParcel(bb) {
    if (bb.isOnDeliveryTile()) {
        console.log('Delivering parcel...');
        await bb.ctx.client.putdown();
        bb.clearActions(); // Clear navigation path after successful delivery
    } else if (bb.hasNavigationPath(dest => bb.destinationIsDeliveryTile(dest))) {
        await stepAlongPath(bb);
    } else {
        const navigationPath = await bb.getPathToClosestTargetTiles(bb.ctx.map.deliveryTiles);
        console.log('Navigation path planned:');
        console.dir(navigationPath, { depth: null });
        bb.loadIntentionActions(navigationPath);
    }
}
