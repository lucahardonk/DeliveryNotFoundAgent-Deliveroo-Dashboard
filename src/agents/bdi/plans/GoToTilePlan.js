import { TILE_TYPES } from '../../base_agent/domain/Tile.js';

/**
 * EXPLORE plans for the BDI plan library.
 *
 * Two plans share the `EXPLORE` trigger:
 *   - `explore-random`    — lowest priority fallback: walk to a random walkable
 *                           tile. Always applicable.
 *   - `explore-staleness` — preferred when spawner tiles exist: head toward the
 *                           spawner sensed longest ago (stale = likely new parcels).
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
export function createExplorePlans(a) {
    const { beliefs, queue, ctx } = a;

    return [
        {
            id: 'explore-random',
            trigger: 'EXPLORE',
            priority: 1,
            source: 'static',
            context: () => true,
            body: async () => {
                if (beliefs.hasNavigationPath(dest => beliefs.destinationIsValidTile(dest))) {
                    await queue.stepAlongPath();
                } else {
                    const me = ctx.me;
                    const map = ctx.map;
                    const validTiles = [];
                    for (let x = 0; x < map.width; x++) {
                        for (let y = 0; y < map.height; y++) {
                            const type = map.tiles[x][y];
                            if (type !== null && type !== TILE_TYPES.wall) {
                                validTiles.push({ x, y });
                            }
                        }
                    }
                    const randomTile = validTiles[Math.floor(Math.random() * validTiles.length)];
                    const path = ctx.planner.aStar(map, { x: me.x, y: me.y }, randomTile);
                    queue.load(path);
                }
            },
        },
        {
            id: 'explore-staleness',
            trigger: 'EXPLORE',
            priority: 5,
            source: 'static',
            context: () => ctx.map.parcelSpawnerTiles.length > 0,
            body: async () => {
                if (beliefs.hasNavigationPath(dest => beliefs.destinationIsValidTile(dest))) {
                    await queue.stepAlongPath();
                } else {
                    const me = ctx.me;
                    const sensed = ctx.world.sensed;
                    const stalestSpawner = ctx.map.parcelSpawnerTiles
                        .filter(t => sensed.tiles[t.x]?.[t.y] !== undefined)
                        .sort((p, q) =>
                            sensed.tiles[p.x][p.y].updateTime -
                            sensed.tiles[q.x][q.y].updateTime
                        )[0];

                    if (!stalestSpawner) return;

                    console.log(`[EXPLORE-staleness] Heading to stale spawner @ (${stalestSpawner.x},${stalestSpawner.y})`);
                    const path = ctx.planner.aStar(
                        ctx.map,
                        { x: me.x, y: me.y },
                        { x: stalestSpawner.x, y: stalestSpawner.y }
                    );
                    queue.load(path);
                }
            },
        },
    ];
}
