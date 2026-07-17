import { DeliverooClient } from '../../core/api/DeliverooClient.js';
import { SocketEventAdapter } from '../../core/api/SocketEventAdapter.js';
import { AgentContext } from './AgentContext.js';
import { buildAgentSnapshot } from '../../core/dashboard/AgentSnapshotBuilder.js';

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
     * @param {boolean} [options.waitForInfo=false] - also await the first `info` tick during init.
     */
    constructor({ dashboardClient = null, trackHeatmap = false, publishToDashboard = false, waitForInfo = false } = {}) {
        this.client = new DeliverooClient();
        this.events = new SocketEventAdapter(this.client);
        this.ctx = new AgentContext(this.client, dashboardClient);

        this._trackHeatmap = trackHeatmap;
        this._publishToDashboard = publishToDashboard;
        this._waitForInfo = waitForInfo;
    }

    /**
     * Performs the initial handshake and registers continuous belief updates.
     * @returns {Promise<void>}
     */
    async init() {
        const waiters = [this.#waitForMap(), this.#waitForYou(), this.#waitForConfig()];
        if (this._waitForInfo) waiters.push(this.#waitForFirstInfo());

        await Promise.all(waiters);

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
        this.client.on('info', (info) => { this.ctx.elapsedTime = info.ms; });

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

    #waitForFirstInfo() {
        return this.events.onceInfo((info) => {
            this.ctx.elapsedTime = info.ms;
        });
    }

    // ── Continuous sensing ──────────────────────────────────────────────────

    #onSensing(sensing) {
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
     * @returns {import("../../core/navigation/Path.js").TileMoveTile[]}
     */
    _currentPath() {
        return [];
    }

    /** @returns {object} a dashboard snapshot of the current state. */
    _buildSnapshot() {
        return buildAgentSnapshot(this.ctx, this._currentPath());
    }
}
