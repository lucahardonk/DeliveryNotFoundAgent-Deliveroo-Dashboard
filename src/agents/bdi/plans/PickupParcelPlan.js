/**
 * PICKUP plans for the BDI plan library.
 *
 * Two plans share the `PICKUP` trigger:
 *   - `pickup-standard` — navigate to the closest sensed parcel and pick up.
 *   - `pickup-bulk`     — higher priority when >= 3 parcels are clustered within
 *                         5 tiles: greedily sweep toward the closest of them.
 *
 * Ported verbatim from `BDI_Agent_2.#buildPlanLibrary()`.
 *
 * @typedef {import("../BdiAgent.js").BdiFacade} BdiFacade
 * @typedef {import("../IntentionSelector.js").Plan} Plan
 */

/**
 * @param {BdiFacade} a
 * @returns {Plan[]}
 */
export function createPickupPlans(a) {
    const { beliefs, queue, ctx, client } = a;

    return [
        {
            id: 'pickup-standard',
            trigger: 'PICKUP',
            priority: 10,
            source: 'static',
            context: () => !beliefs.hasParcel() && ctx.perception.sensedParcels.length > 0,
            body: async () => {
                if (beliefs.isOnParcelTile()) {
                    console.log('[PICKUP-standard] On parcel tile — picking up.');
                    await client.pickup();
                    queue.clear();
                } else if (beliefs.hasNavigationPath(dest => beliefs.destinationIsParcelTile(dest))) {
                    await queue.stepAlongPath();
                } else {
                    const path = await queue.getPathToClosestTargetTiles(
                        ctx.perception.sensedParcels.map(p => ({ x: p.x, y: p.y }))
                    );
                    queue.load(path);
                }
            },
        },
        {
            id: 'pickup-bulk',
            trigger: 'PICKUP',
            priority: 15,
            source: 'static',
            context: () => {
                const me = ctx.me;
                const nearby = ctx.perception.sensedParcels.filter(p =>
                    Math.abs(p.x - me.x) + Math.abs(p.y - me.y) <= 5
                );
                return !beliefs.hasParcel() && nearby.length >= 3;
            },
            body: async () => {
                const me = ctx.me;
                const nearbyParcels = ctx.perception.sensedParcels.filter(p =>
                    Math.abs(p.x - me.x) + Math.abs(p.y - me.y) <= 5 &&
                    p.carriedBy === null
                );

                if (nearbyParcels.length === 0) return;

                if (beliefs.isOnParcelTile()) {
                    console.log('[PICKUP-bulk] On parcel tile — picking up (bulk sweep).');
                    await client.pickup();
                    queue.clear();
                } else {
                    const path = await queue.getPathToClosestTargetTiles(
                        nearbyParcels.map(p => ({ x: p.x, y: p.y }))
                    );
                    queue.load(path);
                }
            },
        },
    ];
}
