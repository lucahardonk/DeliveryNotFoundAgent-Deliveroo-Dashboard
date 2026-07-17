/**
 * Condition: the agent is standing on a tile that holds a free (uncarried) parcel.
 *
 * @param {import("../../BtBlackboard.js").BtBlackboard} bb
 * @returns {boolean}
 */
export function hasParcelAtCurrentPosition(bb) {
    return bb.isOnParcelTile();
}
