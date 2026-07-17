/**
 * Target-selection action: greedy parcel deviation.
 *
 * @typedef {import("../../BtBlackboard.js").BtBlackboard} BtBlackboard
 */

/**
 * Evaluates whether detouring to any free parcel improves the total projected
 * reward versus going straight to delivery. If a beneficial detour is found,
 * loads the path to that parcel and returns true; otherwise returns false.
 *
 * @param {BtBlackboard} bb
 * @returns {Promise<boolean>}
 */
export async function greedyPickupParcel(bb) {
    const pathToDelivery = await bb.getPathToClosestTargetTiles(bb.ctx.map.deliveryTiles);
    let bestReward = bb.carriedParcelsValueAfterSteps(pathToDelivery.distance);
    let bestPath = null;

    for (const parcel of bb.ctx.perception.sensedParcels) {
        if (parcel.carriedBy != null) continue;

        const pathToParcel = await bb.ctx.planner.aStar(
            bb.ctx.map,
            { x: bb.ctx.me.x, y: bb.ctx.me.y },
            { x: parcel.x, y: parcel.y },
            bb.ctx.perception.sensedAgents
        );
        if (!pathToParcel) continue;

        const pathFromParcelToDelivery = await bb.getPathToClosestTargetTiles(
            bb.ctx.map.deliveryTiles,
            { x: parcel.x, y: parcel.y }
        );

        const deviationReward = bb.carriedParcelsValueWithDeviation(
            pathToParcel.distance,
            pathFromParcelToDelivery.distance,
            parcel
        );

        if (deviationReward > bestReward) {
            bestReward = deviationReward;
            bestPath = pathToParcel;
        }
    }

    if (bestPath) {
        console.log('Greedy deviation chosen — path to parcel:');
        console.dir(bestPath, { depth: null });
        bb.loadIntentionActions(bestPath);
        return true;
    }

    return false;
}
