// ─────────────────────────────────────────────────────────────────────────────
// BtAgent — Behaviour-Tree parcel-collection strategy.
//
// The tree is evaluated top-to-bottom every tick (fully reactive, no memory).
// Each branch is a SEQUENCE (all must succeed) inside a root SELECTOR
// (first branch that succeeds wins):
//
//   SELECTOR
//   ├── SEQUENCE: carrying ∧ atDelivery  → putdown
//   ├── SEQUENCE: carrying               → stepToward(nearestDelivery)
//   ├── SEQUENCE: parcelHere             → pickup
//   ├── SEQUENCE: freeParcels exist      → stepToward(nearestParcel)
//   └── explore (always succeeds)
// ─────────────────────────────────────────────────────────────────────────────

import { ServerIO }   from './ServerIO.js';
import { WorldModel } from './WorldModel.js';
import { bfs, nearestReachable } from './Pathfinding.js';
import { report }     from './Dashboard.js';

const DEBUG = true;

export class BtAgent {
    /**
     * @param {{ name:string, host:string, dashboardUrl?:string }} cfg
     */
    constructor({ name, host, dashboardUrl }) {
        this.name         = name;
        this.host         = host;
        this.dashboardUrl = dashboardUrl?.replace(/\/$/, '') ?? null;

        this.world = new WorldModel();
        this.io    = null;   // created in setup() after connect
    }

    // ── Lifecycle (called by main.js) ─────────────────────────────────────────

    async setup(token) {
        this.log('setup', `host=${this.host} token=${token.slice(0, 10)}…`);

        this.io = new ServerIO(this.host, token);

        // One-time setup events
        const mapReady = new Promise((res) => {
            this.io.onMap((_w, _h, rawTiles) => {
                this.log('event:map', `${rawTiles?.length ?? 0} tiles`);
                if (rawTiles?.length) this.world.buildMap(rawTiles);
                res();
            });
        });

        const youReady = new Promise((res) => {
            this.io.onYou((you) => {
                this.world.updateMe(you);
                this.log('event:you', `id=${this.world.me.id} pos=(${this.world.me.x},${this.world.me.y})`);
                res();
            });
        });

        const configReady = new Promise((res) => {
            let done = false;
            this.io.on('config', (cfg) => {
                this.world.config = cfg ?? {};
                this.log('event:config', JSON.stringify(cfg));
                if (!done) { done = true; res(); }
            });
            setTimeout(() => { if (!done) { done = true; this.log('event:config', 'timeout — continuing'); res(); } }, 2000);
        });

        // Continuous sensing
        this.io.onParcels((ps)     => { this.log('event:parcels', `${ps.length}`); this.world.updateParcels(ps); });
        this.io.onAgents((agents)  => { this.world.others = agents; });

        this.log('setup', 'waiting for map + you + config…');
        await Promise.all([mapReady, youReady, configReady]);

        if (!this.world.map)    throw new Error(`[${this.name}] map never arrived`);
        if (!this.world.me.id)  throw new Error(`[${this.name}] you-event never arrived`);

        const { width, height, deliveryTiles, spawnerTiles } = this.world.map;
        this.log('setup', `READY  map=${width}x${height}  delivery=${deliveryTiles.length}  spawners=${spawnerTiles.length}`);
        console.log(`🤖 [${this.name}] connected as ${this.world.me.name ?? this.world.me.id}`);

        await this.postReport('ready', 'connected');
    }

    /** Called every tickMs by main.js. */
    async loop() {
        if (!this.world.map || !this.world.me.id) {
            this.log('loop', 'SKIP — not ready');
            return;
        }

        this.log('loop',
            `pos=(${this.world.me.x},${this.world.me.y})` +
            `  carrying=${this.world.carrying().length}` +
            `  free=${this.world.freeParcels().length}`
        );

        const action = await this._tick();
        this.log('loop', `→ ${action}`);
        await this.postReport('running', action);
    }

    // ── Behaviour Tree ────────────────────────────────────────────────────────

    async _tick() {
        // Branch 1: carrying + at delivery → put down
        if (this.world.carrying().length > 0 && this.world.atDelivery()) {
            const ok = await this.io.putdown();
            return ok ? 'putdown at delivery' : 'putdown failed';
        }

        // Branch 2: carrying → walk to nearest delivery
        if (this.world.carrying().length > 0) {
            const del = nearestReachable(this.world.map, this.world.me, this.world.map.deliveryTiles, this.world.blockedTiles());
            if (del) {
                await this._stepToward(del.target);
                return `deliver → (${del.target.x},${del.target.y}) dist=${del.dist}`;
            }
            return 'deliver (no route)';
        }

        // Branch 3: parcel on current tile → pick up
        const here = this.world.parcelHere();
        if (here) {
            const ok = await this.io.pickup();
            return ok ? `picked up ${here.id}` : `pickup failed ${here.id}`;
        }

        // Branch 4: free parcel exists → walk toward nearest
        const nearest = nearestReachable(this.world.map, this.world.me, this.world.freeParcels(), this.world.blockedTiles());
        if (nearest) {
            await this._stepToward(nearest.target);
            return `→ parcel (${nearest.target.x},${nearest.target.y}) dist=${nearest.dist}`;
        }

        // Branch 5: nothing to do → explore
        return this._explore();
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async _stepToward(target) {
        const blocked = new Set(this.world.blockedTiles().map((b) => `${b.x},${b.y}`));
        blocked.delete(`${target.x},${target.y}`);
        const r = bfs(this.world.map, this.world.me, target, this.world.blockedTiles());
        if (!r?.firstStep) return false;
        this.log('astar', `dist=${r.dist}  dir=${r.firstStep}`);
        const ok = await this.io.move(r.firstStep);
        return Boolean(ok);
    }

    async _explore() {
        const spawners = this.world.map?.spawnerTiles ?? [];
        if (spawners.length) {
            const t = spawners[Math.floor(Math.random() * spawners.length)];
            if (await this._stepToward(t)) return `explore → (${t.x},${t.y})`;
        }
        const dirs = ['up', 'down', 'left', 'right'];
        await this.io.move(dirs[Math.floor(Math.random() * dirs.length)]);
        return 'explore (random)';
    }

    // ── Dashboard ─────────────────────────────────────────────────────────────

    async postReport(status, action) {
        await report(this.dashboardUrl, {
            id:          this.world.me.id ?? this.name,
            type:        'bt',
            label:       this.name,
            status,
            action,
            position:    { x: this.world.me.x, y: this.world.me.y },
            score:       this.world.me.score,
            carrying:    this.world.carrying().length,
            freeParcels: this.world.freeParcels().length,
            map:         this.world.map ? { width: this.world.map.width, height: this.world.map.height } : null,
            updatedAt:   Date.now(),
        });
    }

    // ── Logging ───────────────────────────────────────────────────────────────

    log(tag, msg) {
        if (DEBUG) console.log(`[${this.name}][${tag}] ${msg}`);
    }
}