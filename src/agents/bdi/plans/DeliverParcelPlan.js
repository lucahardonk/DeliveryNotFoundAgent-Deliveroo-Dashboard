/**
 * DELIVER plans for the BDI plan library.
 *
 * Two plans share the `DELIVER` trigger:
 *   - `deliver-standard`       — normal case: navigate to the closest reachable
 *                                delivery tile and put down.
 *   - `deliver-opportunistic`  — higher priority: when a delivery tile is within
 *                                two steps, head straight for it.
 *
 * Both are ported verbatim from `BDI_Agent_2.#buildPlanLibrary()`, now reading
 * the shared context/beliefs/queue through the {@link BdiFacade}.
 *
 * @typedef {import("../BdiAgent.js").BdiFacade} BdiFacade
 * @typedef {import("../IntentionSelector.js").Plan} Plan
 */

/**
 * @param {BdiFacade} a
 * @returns {Plan[]}
 */
export function createDeliverPlans(a) {
    const { beliefs, queue, ctx, client } = a;

    return [
        {
            id: 'deliver-standard',
            trigger: 'DELIVER',
            priority: 10,
            source: 'static',
            context: () => beliefs.hasParcel() && beliefs.deliveryTilesReachable(),
            body: async () => {
                if (beliefs.isOnDeliveryTile()) {
                    console.log('[DELIVER-standard] On delivery tile — putting down.');
                    await client.putdown();
                    queue.clear();
                } else if (beliefs.hasNavigationPath(dest => beliefs.destinationIsDeliveryTile(dest))) {
                    await queue.stepAlongPath();
                } else {
                    const path = await queue.getPathToClosestTargetTiles(ctx.map.deliveryTiles);
                    queue.load(path);
                }
            },
        },
        {
            id: 'deliver-opportunistic',
            trigger: 'DELIVER',
            priority: 20,
            source: 'static',
            context: () => {
                if (!beliefs.hasParcel()) return false;
                const me = ctx.me;
                return ctx.map.deliveryTiles.some(t =>
                    Math.abs(t.x - me.x) + Math.abs(t.y - me.y) <= 2
                );
            },
            body: async () => {
                if (beliefs.isOnDeliveryTile()) {
                    console.log('[DELIVER-opportunistic] On delivery tile — putting down immediately.');
                    await client.putdown();
                    queue.clear();
                } else {
                    const me = ctx.me;
                    const closestAdjacent = ctx.map.deliveryTiles
                        .filter(t => Math.abs(t.x - me.x) + Math.abs(t.y - me.y) <= 2)
                        .sort((p, q) =>
                            (Math.abs(p.x - me.x) + Math.abs(p.y - me.y)) -
                            (Math.abs(q.x - me.x) + Math.abs(q.y - me.y))
                        )[0];

                    const path = ctx.planner.aStar(
                        ctx.map,
                        { x: me.x, y: me.y },
                        { x: closestAdjacent.x, y: closestAdjacent.y }
                    );
                    queue.load(path);
                }
            },
        },
    ];
}
