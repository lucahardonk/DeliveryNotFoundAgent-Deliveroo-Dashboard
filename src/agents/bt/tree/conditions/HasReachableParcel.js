/**
 * Condition: at least one free (uncarried) parcel is currently sensed and thus
 * a candidate pickup target.
 *
 * @param {import("../../BtBlackboard.js").BtBlackboard} bb
 * @returns {boolean}
 */
export function hasReachableParcel(bb) {
    return bb.detectsFreeParcelsNearby();
}
