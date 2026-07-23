// ─────────────────────────────────────────────────────────────────────────────
// GreedyAgent — greedy parcel-collection strategy.
//
// Priority order every tick:
//   1. If carrying parcels  → go deliver them.
//   2. If standing on parcel → pick it up immediately.
//   3. If a free parcel is visible → walk toward the nearest one.
//   4. Otherwise → explore (walk toward random spawner tiles).
//
// The agent does NOT look ahead or plan multi-step strategies.
// It reacts purely to the current observable world state.
// ─────────────────────────────────────────────────────────────────────────────

import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import { astar, direction } from './astar.js';
import { WorldModel }       from './WorldModel.js';
import { ServerIO }         from './ServerIO.js';
import { report }           from './Dashboard.js';

const DEBUG = true;

const STATE = Object.freeze({
    EXPLORING:  'exploring',
    PICKING_UP: 'picking_up',
    DELIVERING: 'delivering',
});

export class GreedyAgent {
    /**
     * @param {{ name: string, host: string, dashboardUrl?: string }} cfg
     */
    constructor({ name, host, dashboardUrl }) {
        this.name         = name;
        this.host         = host;
        this.dashboardUrl = dashboardUrl?.replace(/\/$/, '') ?? null;

        this.world = new WorldModel(); // all game state lives here
        this.io    = null;             // created in setup() after DjsConnect

        this.state        = STATE.EXPLORING;
        this.searchTarget = null; // current exploration waypoint
    }

    // ── Lifecycle (called by main.js) ─────────────────────────────────────────

    /**
     * Connects to the game server and waits until the agent is fully initialised:
     *   - map received and parsed
     *   - agent identity + position known
     *   - server config received (or 2s timeout)
     *
     * Throws if the map or identity never arrive (bad host / token).
     */
    async setup(token) {
        this.log('setup', `host=${this.host} token=${token.slice(0, 10)}…`);

        const client = DjsConnect(this.host, token);
        this.io      = new ServerIO(client, this.name);

        // ── One-time setup events ──────────────────────────────────────────

        const mapReady = new Promise((resolve) => {
            client.onMap((_w, _h, rawTiles) => {
                this.log('event:map', `${rawTiles?.length ?? 0} tiles received`);
                if (rawTiles?.length) this.world.buildMap(rawTiles);
                resolve();
            });
        });

        const youReady = new Promise((resolve) => {
            client.onYou((you) => {
                this.world.updateMe(you);
                this.log('event:you', `id=${this.world.me.id} pos=(${this.world.me.x},${this.world.me.y})`);
                resolve();
            });
        });

        // `config` is optional on some server builds — resolve after 2 s if missing.
        const configReady = new Promise((resolve) => {
            let done = false;
            client.on('config', (cfg) => {
                this.world.config = cfg ?? {};
                this.log('event:config', JSON.stringify(cfg));
                if (!done) { done = true; resolve(); }
            });
            setTimeout(() => {
                if (!done) {
                    done = true;
                    this.log('event:config', 'no config after 2 s — continuing');
                    resolve();
                }
            }, 2000);
        });

        // ── Continuous sensing (run for the entire session) ────────────────

        this.io.hookParcels((ps) => {
            this.log('event:parcels', `${ps.length} parcels`);
            this.world.updateParcels(ps);
        });

        this.io.hookAgents((agents) => {
            this.world.others = agents;
        });

        // ── Wait for all setup events before returning ─────────────────────

        this.log('setup', 'waiting for map + you + config…');
        await Promise.all([mapReady, youReady, configReady]);

        if (!this.world.map)
            throw new Error(`[${this.name}] map never arrived — check HOST`);
        if (!this.world.me.id)
            throw new Error(`[${this.name}] you-event never arrived — bad token?`);

        const { width, height, deliveryTiles, spawnerTiles } = this.world.map;
        this.log('setup', `READY  map=${width}x${height}  delivery=${deliveryTiles.length}  spawners=${spawnerTiles.length}`);
        console.log(`🤖 [${this.name}] connected as ${this.world.me.name ?? this.world.me.id} at (${this.world.me.x},${this.world.me.y})`);

        await this.postReport('ready', 'connected');
    }

    /**
     * Called every tickMs by main.js.
     * Skips silently if the world model is not ready yet.
     */
    async loop() {
        if (!this.world.map || !this.world.me.id) {
            this.log('loop', 'SKIP — not ready');
            return;
        }

        this.log('loop',
            `state=${this.state}  pos=(${this.world.me.x},${this.world.me.y})` +
            `  carrying=${this.world.carrying().length}` +
            `  freeParcels=${this.world.freeParcels().length}`
        );

        const action = await this.decide();

        this.log('loop', `→ ${action}`);
        await this.postReport(this.state, action);
    }

    // ── Decision logic ────────────────────────────────────────────────────────

    async decide() {
        // Priority 1: deliver if holding anything.
        if (this.world.carrying().length > 0) {
            this.state = STATE.DELIVERING;
            return this.doDeliver();
        }

        // Priority 2: pick up if standing on a free parcel right now.
        const here = this.world.parcelHere();
        if (here) {
            this.state = STATE.PICKING_UP;
            this.log('decide', `parcel ${here.id} on tile — pickup`);
            const ok = await this.io.doPickup();
            return ok ? `picked up ${here.id}` : `pickup failed for ${here.id}`;
        }

        // Priority 3: walk toward the nearest reachable free parcel.
        const nearest = this.nearestReachable(this.world.freeParcels());
        if (nearest) {
            this.state = STATE.PICKING_UP;
            this.log('decide', `heading to parcel ${nearest.target.id} at (${nearest.target.x},${nearest.target.y}) dist=${nearest.distance}`);
            const moved = await this.stepToward(nearest.target);
            return moved
                ? `→ parcel (${nearest.target.x},${nearest.target.y})`
                : `unreachable parcel ${nearest.target.id}`;
        }

        // Priority 4: nothing visible — explore the map.
        this.state = STATE.EXPLORING;
        return this.doExplore();
    }

    async doDeliver() {
        if (this.world.atDelivery()) {
            this.log('decide', 'at delivery tile — putdown');
            const ok = await this.io.doPutdown();
            return ok ? 'delivered' : 'putdown failed';
        }

        const delivery = this.nearestReachable(this.world.map.deliveryTiles);
        if (!delivery) return 'no reachable delivery tile';

        this.log('decide', `heading to delivery (${delivery.target.x},${delivery.target.y}) dist=${delivery.distance}`);
        const moved = await this.stepToward(delivery.target);
        return moved
            ? `→ delivery (${delivery.target.x},${delivery.target.y})`
            : 'delivery unreachable';
    }

    async doExplore() {
        // Pick a new target when: no target, already there, or target became a wall.
        if (
            !this.searchTarget ||
            this.world.isAt(this.searchTarget) ||
            !this.world.walkable(this.searchTarget.x, this.searchTarget.y)
        ) {
            this.searchTarget = this.pickExploreTarget();
            this.log('explore', this.searchTarget
                ? `new target (${this.searchTarget.x},${this.searchTarget.y})`
                : 'no target found');
        }

        if (!this.searchTarget) return 'no exploration target';

        const moved = await this.stepToward(this.searchTarget);
        if (!moved) {
            this.searchTarget = null; // try a different target next tick
            return 'explore target unreachable';
        }
        return `exploring → (${this.searchTarget.x},${this.searchTarget.y})`;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    /**
     * Computes the full A* path to target, then sends only the first step.
     * One move per tick keeps the agent reactive — it can re-route every loop.
     */
    async stepToward(target) {
        // Build the blocked-cells set from current other-agent positions.
        // The goal cell is excluded so the agent can step onto it.
        const blocked = new Set(
            this.world.others.map((a) => `${Math.round(a.x)},${Math.round(a.y)}`),
        );
        blocked.delete(`${target.x},${target.y}`);

        const path = astar(
            this.world.me,
            target,
            (x, y) => this.world.walkable(x, y),
            blocked,
        );

        if (!path || path.length === 0) {
            this.log('astar', `no path from (${this.world.me.x},${this.world.me.y}) to (${target.x},${target.y})`);
            return false;
        }

        const next = path[0];
        const dir  = direction(this.world.me, next);
        this.log('astar', `path len=${path.length}  next=(${next.x},${next.y})  dir=${dir}`);

        const ok = await this.io.doMove(dir);
        this.log('move', `${dir} → ${ok ? 'ok' : 'FAILED'}`);
        return Boolean(ok);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Picks a random spawner tile (or any walkable tile if no spawners exist)
     * that is reachable from the current position.
     * Randomness prevents the agent from always cycling the same path.
     */
    pickExploreTarget() {
        const pool = this.world.map.spawnerTiles.length
            ? this.world.map.spawnerTiles
            : this.world.map.walkableTiles;

        const shuffled = [...pool].sort(() => Math.random() - 0.5);

        const blocked = new Set(
            this.world.others.map((a) => `${Math.round(a.x)},${Math.round(a.y)}`),
        );

        for (const t of shuffled) {
            if (!this.world.isAt(t)) {
                const path = astar(this.world.me, t, (x, y) => this.world.walkable(x, y), blocked);
                if (path !== null) return t;
            }
        }

        return null;
    }

    /**
     * Finds the closest reachable goal from an array of candidates.
     * "Reachable" means A* returns a non-null path.
     *
     * @param {{ x: number, y: number }[]} goals
     * @returns {{ target: object, distance: number } | null}
     */
    nearestReachable(goals) {
        const blocked = new Set(
            this.world.others.map((a) => `${Math.round(a.x)},${Math.round(a.y)}`),
        );

        let best = null;

        for (const target of goals) {
            const path = astar(this.world.me, target, (x, y) => this.world.walkable(x, y), blocked);
            if (path === null) continue;
            if (!best || path.length < best.distance) {
                best = { target, distance: path.length };
            }
        }

        return best;
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────

    async postReport(status, action) {
        await report(this.dashboardUrl, {
            id:          this.world.me.id ?? this.name,
            type:        'greedy',
            label:       this.name,
            status,
            action,
            position:    { x: this.world.me.x, y: this.world.me.y },
            score:       this.world.me.score,
            carrying:    this.world.carrying().length,
            freeParcels: this.world.freeParcels().length,
            map:         this.world.map
                            ? { width: this.world.map.width, height: this.world.map.height }
                            : null,
            updatedAt:   Date.now(),
        });
    }

    // ── Debug ─────────────────────────────────────────────────────────────────

    log(tag, msg) {
        if (DEBUG) console.log(`[${this.name}][${tag}] ${msg}`);
    }
}