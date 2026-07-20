/**
 * Builds the serializable snapshot of an agent's current state that gets pushed
 * to the dashboard server. Kept separate from any concrete agent so every agent
 * type (BDI, BT, ...) produces exactly the same shape.
 *
 * @typedef {import("../agents/base_agent/capabilities/Path.js").TileMoveTile} TileMoveTile
 * @typedef {import("../agents/base_agent/AgentContext.js").AgentContext} AgentContext
 */

/**
 * @param {AgentContext} ctx - the agent's shared context (world, perception, reachability, heatmap, self-state).
 * @param {TileMoveTile[]} [currentPath=[]] - the agent's currently queued moves.
 * @returns {object} a plain, JSON-serialisable snapshot.
 */
export function buildAgentSnapshot(ctx, currentPath = []) {
    const dest = currentPath.length > 0 ? currentPath.at(-1).to : null;
    const me = ctx.state.me;
    const map = ctx.world.map;

    return {
        agentId: me.id,
        name: me.name,
        x: me.x,
        y: me.y,
        score: me.score,
        penalty: me.penalty,
        worldMap: { width: map.width, height: map.height, tiles: map.tiles },
        sccMap: ctx.reachability.sccMap,
        deliveryTiles: map.deliveryTiles,
        parcelSpawnerTiles: map.parcelSpawnerTiles,
        sensedParcels: [...ctx.perception.sensedParcels],
        sensedAgents: [...ctx.perception.sensedAgents],
        currentPath: [...currentPath],
        destination: dest,
        heatmap: ctx.heatmap.matrix,
        elapsedTime: ctx.elapsedTime,
    };
}
