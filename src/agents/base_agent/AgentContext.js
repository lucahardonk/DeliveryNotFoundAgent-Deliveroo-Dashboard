import { WorldState } from './beliefs/WorldState.js';
import { PerceptionStore } from './beliefs/PerceptionStore.js';
import { ReachabilityMap } from './beliefs/ReachabilityMap.js';
import { Heatmap } from './beliefs/Heatmap.js';
import { AStarPlanner } from './capabilities/AStarPlanner.js';
import { MovementExecutor } from './capabilities/MovementExecutor.js';
import { AgentState } from './domain/AgentState.js';
import { GameConfig } from './domain/GameConfig.js';

/**
 * The shared "world model + services" bundle every agent operates on.
 *
 * Instead of scattering beliefs across private class fields (as the original
 * monolithic agents did), all state and core services live here in one object
 * that is passed to beliefs, plans, conditions and actions. This is what lets
 * the agent logic be split across many small, testable modules.
 */
export class AgentContext {
    /**
     * @param {import("../../dashboard/api/DeliverooClient.js").DeliverooClient} client
     * @param {object|null} [dashboardClient] - optional dashboard ingestion client.
     */
    constructor(client, dashboardClient = null) {
        /** Raw server connection. */
        this.client = client;
        /** Optional dashboard push client (null when running headless). */
        this.dashboardClient = dashboardClient;

        // ── Beliefs ────────────────────────────────────────────────────────
        /** Static map + sensing-freshness grid. */
        this.world = new WorldState();
        /** Currently sensed parcels / agents. */
        this.perception = new PerceptionStore();
        /** SCC-based reachability derived from the map. */
        this.reachability = new ReachabilityMap();
        /** Cumulative parcel-sighting heatmap. */
        this.heatmap = new Heatmap();
        /** The agent's own position / score. */
        this.state = new AgentState();
        /** Parsed game options. */
        this.config = new GameConfig();
        /** Last server clock reading (ms). */
        this.elapsedTime = 0;

        // ── Services ───────────────────────────────────────────────────────
        /** Shortest-path planner. */
        this.planner = new AStarPlanner();
        /** Retry-aware movement executor. */
        this.movement = new MovementExecutor(client);
    }

    /** Convenience accessor for the static map model. */
    get map() {
        return this.world.map;
    }

    /** Convenience accessor for the raw self object. */
    get me() {
        return this.state.me;
    }
}
