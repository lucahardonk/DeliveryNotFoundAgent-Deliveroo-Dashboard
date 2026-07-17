import { hasReachableParcel } from './conditions/HasReachableParcel.js';
import { deliverParcel } from './actions/DeliverParcels.js';
import { pickupClosestParcel, pickUpHere } from './actions/PickUpParcel.js';
import { randomlyExploreMap, stepAlongPath } from './actions/MoveToTarget.js';
import { greedyPickupParcel } from './actions/SelectParcelTarget.js';

/**
 * Builds the behaviour tree for the BT agent.
 *
 * The tree is expressed as a single `tick(bb)` function that reproduces the
 * original agent's decision flow, but now delegates every leaf to the
 * dedicated condition/action modules:
 *
 *   root (priority selector)
 *   ├── [carrying a parcel]
 *   │     ├── if on a parcel tile → pick it up
 *   │     ├── if mid-deviation to a parcel → step along the path
 *   │     └── else → try a greedy pickup deviation, otherwise deliver
 *   ├── [free parcels sensed] → go pick up the closest parcel
 *   └── [otherwise]           → explore toward a spawner tile
 *
 * @returns {{ tick: (bb: import("../BtBlackboard.js").BtBlackboard) => Promise<void> }}
 */
export function buildTree() {
    /**
     * Executes a single deliberation tick against the blackboard.
     * @param {import("../BtBlackboard.js").BtBlackboard} bb
     */
    async function tick(bb) {
        if (bb.hasParcel()) {
            if (bb.isOnParcelTile()) {
                // Deviation goal reached: grab the parcel and reset the path.
                await pickUpHere(bb);
                return; // Don't continue to delivery in the same tick
            }

            if (bb.hasNavigationPath(dest => bb.destinationIsParcelTile(dest))) {
                // Mid-deviation: execute the next step toward the greedy parcel.
                console.log('HERE SHOULD MOVE');
                await stepAlongPath(bb);
            } else {
                // No deviation active: re-evaluate whether a detour is worthwhile.
                if (hasReachableParcel(bb)) {
                    const deviating = await greedyPickupParcel(bb);
                    if (deviating) return; // start executing the deviation next tick
                }
                console.log('I have a parcel, trying to deliver...');
                await deliverParcel(bb);
            }
        } else if (hasReachableParcel(bb)) {
            console.log('Parcels detected nearby, moving to pick up the closest...');
            await pickupClosestParcel(bb);
        } else {
            await randomlyExploreMap(bb);
            await new Promise((r) => setTimeout(r, 0));
        }
    }

    return { tick };
}
