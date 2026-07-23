import { DeliverooClient } from '../DeliverooClient.js';
import { buildMap, bfs, nearestReachable, TILE } from '../grid.js';

/**
 * Shared foundation for every agent strategy (BT, BDI, base/greedy).
 *
 * Owns the parts that are identical across strategies:
 *   - the connection + initial handshake (map / you / config);
 *   - the live world model kept fresh by sensing events (self, parcels, agents);
 *   - low-level capabilities (move one step, pickup, putdown, BFS navigation);
 *   - fire-and-forget state reporting to the standalone dashboard over HTTP.
 *
 * Subclasses implement a single method — {@link AgentCore#run} — which is their
 * own deliberation loop and "capabilities" wiring.
 */
export class AgentCore {
    /**
     * @param {object} opts
     * @param {string} opts.token         - auth token for this agent.
     * @param {string} opts.host          - Deliveroo server URL.
     * @param {string} opts.dashboardUrl  - dashboard base URL for state reporting.
     * @param {string} opts.type          - strategy id ('bt' | 'bdi' | 'base').
     * @param {string} [opts.label]       - human-friendly label used in logs.
     * @param {object} [opts.client]      - inject a client (used for testing); a
     *                                       real {@link DeliverooClient} otherwise.
     */
    constructor({ token, host, dashboardUrl, type, label, client }) {
        this.type = type;
        this.label = label || type;
        this.dashboardUrl = dashboardUrl;
        this.client = client || new DeliverooClient({ token, host });

        // ── Beliefs / world model ───────────────────────────────────────────
        this.map = null;
        this.config = {};
        this.me = { id: null, name: null, x: 0, y: 0, score: 0 };
        /** @type {Map<string, object>} parcelId -> parcel */
        this.parcels = new Map();
        /** @type {Array<object>} other agents currently sensed */
        this.others = [];

        this._ready = false;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    /** Connects and blocks until the initial beliefs (map, self, config) arrive. */
    async connect() {
        const gotMap = new Promise((res) => {
            this.client.onMap((_w, _h, tiles) => {
                if (tiles && tiles.length) this.map = buildMap(tiles);
                res();
            });
        });
        const gotYou = new Promise((res) => {
            this.client.onYou((you) => {
                this._updateMe(you);
                res();
            });
        });
        const gotConfig = new Promise((res) => {
            let done = false;
            this.client.on('config', (config) => {
                this.config = config || {};
                if (!done) { done = true; res(); }
            });
            // config is optional on some servers — don't block forever.
            setTimeout(() => { if (!done) { done = true; res(); } }, 2000);
        });

        // Continuous sensing keeps beliefs fresh.
        this.client.onParcelsSensing((parcels) => this._updateParcels(parcels || []));
        this.client.onAgentsSensing((agents) => { this.others = agents || []; });

        await Promise.all([gotMap, gotYou, gotConfig]);
        this._ready = true;
        console.log(`[${this.label}] connected as ${this.me.name ?? this.me.id} at (${this.me.x},${this.me.y})`);
    }

    /**
     * Starts the agent: connect, then run its own loop. Reconnects on crash.
     * @returns {Promise<void>}
     */
    async start() {
        await this.connect();
        await this.reportState('running', 'idle');
        try {
            await this.run();
        } catch (err) {
            console.error(`[${this.label}] loop crashed:`, err?.message ?? err);
            await this.reportState('error', String(err?.message ?? err));
        }
    }

    /** Subclasses MUST override with their own deliberation loop. */
    async run() {
        throw new Error('run() must be implemented by the concrete agent');
    }

    // ── Belief updates ────────────────────────────────────────────────────────

    _updateMe(you) {
        if (!you) return;
        this.me.id = you.id;
        this.me.name = you.name;
        this.me.x = Math.round(you.x);
        this.me.y = Math.round(you.y);
        this.me.score = you.score ?? this.me.score;
    }

    _updateParcels(sensed) {
        // Refresh currently-sensed parcels; drop ones that were picked up/expired.
        const seen = new Set();
        for (const p of sensed) {
            seen.add(p.id);
            this.parcels.set(p.id, { ...p, x: Math.round(p.x), y: Math.round(p.y) });
        }
        // Remove parcels that are in view range but no longer reported.
        for (const [id, p] of this.parcels) {
            if (!seen.has(id) && this._inView(p)) this.parcels.delete(id);
        }
    }

    _inView(p) {
        const range = this.config?.PARCELS_OBSERVATION_DISTANCE ?? 5;
        return Math.abs(p.x - this.me.x) + Math.abs(p.y - this.me.y) <= range;
    }

    // ── Belief queries ──────────────────────────────────────────────────────

    /** Parcels currently carried by me. */
    carrying() {
        return [...this.parcels.values()].filter((p) => p.carriedBy === this.me.id);
    }

    /** Free parcels on the ground (not carried by anyone). */
    freeParcels() {
        return [...this.parcels.values()].filter((p) => !p.carriedBy);
    }

    /** Tiles occupied by other agents (obstacles for navigation). */
    blockedTiles() {
        return this.others.map((a) => ({ x: Math.round(a.x), y: Math.round(a.y) }));
    }

    /** Nearest reachable free parcel, or null. */
    nearestFreeParcel() {
        const goals = this.freeParcels().map((p) => ({ ...p, x: p.x, y: p.y }));
        if (!goals.length) return null;
        return nearestReachable(this.map, this.me, goals, this.blockedTiles());
    }

    /** Nearest reachable delivery tile, or null. */
    nearestDelivery() {
        if (!this.map?.deliveryTiles?.length) return null;
        return nearestReachable(this.map, this.me, this.map.deliveryTiles, this.blockedTiles());
    }

    // ── Capabilities (actions) ────────────────────────────────────────────────

    /** Takes one BFS step toward `target`. @returns {Promise<boolean>} moved? */
    async stepToward(target) {
        const plan = bfs(this.map, this.me, target, this.blockedTiles());
        if (!plan || !plan.firstStep) return false;
        const ok = await this.client.move(plan.firstStep);
        return Boolean(ok);
    }

    /** @returns {Promise<boolean>} */
    async pickup() {
        const res = await this.client.pickup();
        return Boolean(res && (Array.isArray(res) ? res.length : true));
    }

    /** @returns {Promise<boolean>} */
    async putdown() {
        const res = await this.client.putdown();
        return Boolean(res);
    }

    /** True when standing on a delivery tile. */
    atDelivery() {
        return this.map?.tiles?.[this.me.x]?.[this.me.y] === TILE.delivery;
    }

    /** A free parcel lying on my current tile, or null. */
    parcelHere() {
        return this.freeParcels().find((p) => p.x === this.me.x && p.y === this.me.y) || null;
    }

    // ── Dashboard reporting ────────────────────────────────────────────────────

    /**
     * Fire-and-forget snapshot POST to the standalone dashboard. Never throws,
     * so dashboard downtime can't block or crash the agent loop.
     * @param {string} status  - e.g. 'running' | 'error'
     * @param {string} action  - human-readable current action
     */
    async reportState(status, action) {
        const id = this.me.id ?? this.label;
        const snapshot = {
            id,
            type: this.type,
            label: this.label,
            status,
            action,
            position: { x: this.me.x, y: this.me.y },
            score: this.me.score,
            carrying: this.carrying().length,
            freeParcels: this.freeParcels().length,
            map: this.map ? { width: this.map.width, height: this.map.height } : null,
            updatedAt: Date.now(),
        };
        try {
            await fetch(`${this.dashboardUrl}/api/agents/${encodeURIComponent(id)}/state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot),
            });
        } catch {
            /* dashboard not up / unreachable — ignore */
        }
    }

    /** Small async sleep helper. */
    sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
}
