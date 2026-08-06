// ─────────────────────────────────────────────────────────────────────────────
// BtAgent — Behaviour-Tree parcel-collection strategy.
//
// The tree (see RunningTree.js) is built from the generic Selector/Sequence/
// Condition/Action nodes in BehaviourTree.js and evaluated top-to-bottom every
// tick (fully reactive, no memory). This agent instance is the `ctx` passed to
// each node — it exposes .world, .io, ._stepToward and .lastAction.
// ─────────────────────────────────────────────────────────────────────────────

import { ServerIO }   from './ServerIO.js';
import { WorldModel } from './WorldModel.js';
import { aStar }      from './Pathfinding.js';
import { allowedExitDirection } from './MapModel.js';
import { safeRandomDirection } from './MapRegions.js';
import { report }     from './Dashboard.js';
import { buildTree } from './RunningTree.js';

const DEBUG = true;

export class BtAgent {
    /**
     * @param {{ name:string, host:string, dashboardUrl?:string, exploreRadius?:number, enemyAvoidRadius?:number }} cfg
     */
    constructor({ name, host, dashboardUrl, exploreRadius = 10, enemyAvoidRadius = 5 }) {
        this.name         = name;
        this.host         = host;
        this.dashboardUrl = dashboardUrl?.replace(/\/$/, '') ?? null;

        this.world = new WorldModel();
        this.io    = null;   // created in setup() after connect
        this.tree  = buildTree();
        /** @type {string|null} set by tree leaves each tick, read back by _tick() */
        this.lastAction = null;

        // Explore leaf config (RunningTree.js `explore` / ExploreTarget.js).
        this.exploreRadius    = exploreRadius;
        this.enemyAvoidRadius = enemyAvoidRadius;
        /** @type {{x:number,y:number}|null} committed explore target, persisted across ticks */
        this.exploreTarget = null;

        // Consecutive _stepToward failures (no path, or move rejected by the
        // server) — almost always another agent occupying the way. Recomputing
        // A* every tick just picks the same blocked route again, so after a
        // few failures we force one direction for a few ticks to physically
        // break the deadlock instead.
        this._stepFailCount   = 0;
        this._forcedTicksLeft = 0;
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
    // Tree structure lives in RunningTree.js; this just ticks it with itself as
    // context and reports back whatever action the winning leaf recorded.

    async _tick() {
        this.lastAction = null;
        await this.tree.tick(this);
        return this.lastAction;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async _stepToward(target) {
        const r = aStar(this.world.map, this.world.me, target, this.world.blockedTiles());
        if (!r?.firstStep) {
            this.log('astar', `no path to (${target.x},${target.y})`);
            this._onStepFailure();
            return false;
        }
        const { x: mx, y: my } = this.world.me;
        const tileHere = this.world.map.tiles[mx]?.[my];
        const allowedDir = allowedExitDirection(this.world.map, mx, my);
        this.log('astar', `dist=${r.dist}  dir=${r.firstStep}  from=(${mx},${my}) tile='${tileHere}' allowedExit=${allowedDir}`);
        const ok = await this.io.move(r.firstStep);
        this.log('move', `dir=${r.firstStep} → ${ok ? 'ok' : 'REJECTED by server'}`);
        if (ok) this._stepFailCount = 0;
        else this._onStepFailure();
        return Boolean(ok);
    }

    /**
     * True while a forced-direction override from a recent stuck detection is
     * active. Checked by the tree's top-priority branch, ahead of any normal
     * pathfinding, so the override actually gets consumed even on ticks where
     * the usual leaves would find no reachable target at all and never touch
     * movement (e.g. a delivery tile fully cut off by another agent).
     */
    hasForcedMove() {
        return this._forcedTicksLeft > 0;
    }

    /**
     * Runs one tick of the forced-recovery override. Only call when
     * hasForcedMove() is true. Re-evaluates a safe direction from the
     * CURRENT position on every call (not just once at arming time) — a
     * multi-tick escape must never blindly repeat a captured direction,
     * since continuing straight after the first step could walk off a
     * one-way tile into territory that's since become unsafe/unreachable.
     */
    async _consumeForcedMove() {
        this._forcedTicksLeft--;
        const dir = this.world.map
            ? safeRandomDirection(this.world.map, this.world.me, this.world.blockedTiles())
            : ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];
        const ok = await this.io.move(dir);
        this.log('move', `forced dir=${dir} (${this._forcedTicksLeft} left) → ${ok ? 'ok' : 'REJECTED by server'}`);
        return Boolean(ok);
    }

    /**
     * Registers a tick where movement toward a target failed or no reachable
     * target existed at all — both usually mean another agent is in the way.
     * After 3 consecutive calls, arms a forced-recovery override (see
     * hasForcedMove/_consumeForcedMove) for the next 3 ticks so the agent
     * physically steps off the contested tile instead of recomputing the same
     * blocked route forever.
     */
    _onStepFailure() {
        this._stepFailCount++;
        if (this._stepFailCount < 3) return;
        this._stepFailCount = 0;
        this._forcedTicksLeft = 3;
        this.log('stuck', '3 consecutive failures → forcing safe steps for 3 ticks');
    }


    // ── Dashboard ─────────────────────────────────────────────────────────────

    async postReport(status, action) {
        const map = this.world.map;
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
            map: map ? {
                width:  map.width,
                height: map.height,
                myRegionId: map.regions?.regionId?.[this.world.me.x]?.[this.world.me.y] ?? null,
                myStatus:   map.regions?.statusGrid?.[this.world.me.x]?.[this.world.me.y] ?? null,
                regions:    map.regions?.list ?? [],
                // Full per-tile grids only once, on the initial connect report —
                // static after map load, not worth re-sending every tick.
                ...(status === 'ready' ? {
                    mapRegionsGrid: map.regions?.regionId   ?? null,
                    mapStatusGrid:  map.regions?.statusGrid ?? null, // 'green'/'red'/null per tile
                } : {}),
            } : null,
            updatedAt:   Date.now(),
        });
    }

    // ── Logging ───────────────────────────────────────────────────────────────

    log(tag, msg) {
        if (DEBUG) console.log(`[${this.name}][${tag}] ${msg}`);
    }
}