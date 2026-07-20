import { DeliverooClient } from '../../dashboard/api/DeliverooClient.js';
import { SocketEventAdapter } from '../../dashboard/api/SocketEventAdapter.js';
import { AgentContext } from './AgentContext.js';
import { buildAgentSnapshot } from '../../dashboard/AgentSnapshotBuilder.js';

/**
 * Base class shared by every concrete agent (BDI, BT, ...).
 *
 * Owns the connection lifecycle and the belief-update wiring that is identical
 * across strategies:
 *   - connect and wait for the initial beliefs (map, self, config[, info]);
 *   - build the world model and compute reachability once;
 *   - register the continuous `sensing` / `info` listeners that keep beliefs
 *     fresh (and optionally maintain the heatmap / push dashboard snapshots).
 *
 * Subclasses implement their own `start()` (deliberation loop) and may override
 * {@link BaseAgent#_afterSensing} and {@link BaseAgent#_currentPath}.
 */
export class BaseAgent {
    /**
     * @param {object} [options]
     * @param {object|null} [options.dashboardClient] - dashboard push client, or null.
     * @param {boolean} [options.trackHeatmap=false] - maintain the parcel heatmap.
     * @param {boolean} [options.publishToDashboard=false] - push snapshots on each sensing.
     * @param {string} [options.token] - auth token for this agent; defaults to `process.env.TOKEN`.
     * @param {string} [options.host] - server URL; defaults to `process.env.HOST`.
     */
    constructor({ dashboardClient = null, trackHeatmap = false, publishToDashboard = false, token, host } = {}) {
        this.client = new DeliverooClient({ token, host });
        this.events = new SocketEventAdapter(this.client);
        this.ctx = new AgentContext(this.client, dashboardClient);

        this._trackHeatmap = trackHeatmap;
        this._publishToDashboard = publishToDashboard;
    }

    /**
     * Performs the initial handshake and registers continuous belief updates.
     * @returns {Promise<void>}
     */
    async init() {
        // NOTE: we intentionally do NOT block on the `info` event. In this SDK
        // version `info` is deprecated and only emitted for admin tokens, so a
        // normal agent that awaited it would hang forever in init(). We instead
        // derive `elapsedTime` from a wall-clock start time (see #onSensing).
        const waiters = [this.#waitForMap(), this.#waitForYou(), this.#waitForConfig()];

        await Promise.all(waiters);

        // Reference point for elapsed-time tracking (used by staleness-based
        // exploration and the dashboard).
        this._startTime = Date.now();

        console.log('Initial beliefs acquired');

        if (this._trackHeatmap) {
            this.ctx.heatmap.init(this.ctx.map.width, this.ctx.map.height);
            if (this.ctx.dashboardClient) {
                this.ctx.dashboardClient.registerAgent(this.ctx.me.id, {
                    width: this.ctx.map.width,
                    height: this.ctx.map.height,
                    tiles: this.ctx.map.tiles,
                });
            }
        }

        // Derived belief — computed once from the static map.
        this.ctx.reachability.compute(this.ctx.map);

        // Continuous belief updates.
        this.client.onSensing((sensing) => this.#onSensing(sensing));
        // Keep listening for `info` in case an admin token receives it; harmless
        // otherwise. Wall-clock time (below) is the primary source.
        this.client.on('info', (info) => { if (info && typeof info.ms === 'number') this.ctx.elapsedTime = info.ms; });

        console.log('All beliefs acquired — agent ready.');
    }

    // ── Initial belief waiters ─────────────────────────────────────────────

    #waitForMap() {
        return this.events.onceMap((_w, _h, tiles) => {
            this.ctx.world.buildFromTiles(tiles);
        });
    }

    #waitForYou() {
        return this.events.onceYou((you) => {
            this.ctx.state.update(you);
        });
    }

    #waitForConfig() {
        return this.events.onceConfig((config) => {
            this.ctx.config.set(config);
            console.log('Game config:', config);
        });
    }

    // ── Continuous sensing ──────────────────────────────────────────────────

    #onSensing(sensing) {
        // Advance the elapsed-time clock from the wall clock. This replaces the
        // deprecated `info.ms` tick and keeps staleness-based exploration working.
        if (this._startTime != null) this.ctx.elapsedTime = Date.now() - this._startTime;

        this.ctx.world.markSensed(sensing.positions, this.ctx.elapsedTime);
        this.ctx.perception.updateFromSensing(sensing);

        if (this._trackHeatmap) {
            this.ctx.heatmap.increment(sensing.parcels);
        }

        this._afterSensing(sensing);

        if (this._publishToDashboard && this.ctx.dashboardClient) {
            this.ctx.dashboardClient.update(this.ctx.me.id, this._buildSnapshot());
        }
    }

    /**
     * Hook for subclasses to react to a fresh sensing update. No-op by default.
     * @param {object} _sensing
     */
    _afterSensing(_sensing) {}

    /**
     * The agent's currently queued moves, used when building dashboard
     * snapshots. Overridden by subclasses that expose an intention queue.
     * @returns {import("./capabilities/Path.js").TileMoveTile[]}
     */
    _currentPath() {
        return [];
    }

    /** @returns {object} a dashboard snapshot of the current state. */
    _buildSnapshot() {
        return buildAgentSnapshot(this.ctx, this._currentPath());
    }
}
