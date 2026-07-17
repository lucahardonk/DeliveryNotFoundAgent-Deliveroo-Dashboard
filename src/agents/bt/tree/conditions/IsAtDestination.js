/**
 * Condition: the agent currently has a planned navigation path whose final
 * destination satisfies `predicate` (e.g. "is a delivery tile", "is a parcel
 * tile", "is a still-valid tile").
 *
 * @param {import("../../BtBlackboard.js").BtBlackboard} bb
 * @param {(destination: import("../../../../core/domain/Position.js").TilePosition) => boolean} predicate
 * @returns {boolean}
 */
export function isAtDestination(bb, predicate) {
    return bb.hasNavigationPath(predicate);
}
