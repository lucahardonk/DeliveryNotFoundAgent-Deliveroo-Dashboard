// ─────────────────────────────────────────────────────────────────────────────
// BdiAgent — Belief-Desire-Intention skeleton (reference implementation).
// ─────────────────────────────────────────────────────────────────────────────

import { ServerIO }              from '../bt/ServerIO.js';
import { WorldModel }            from '../bt/WorldModel.js';
import { bfs, nearestReachable } from '../bt/Pathfinding.js';
import { report }                from '../bt/Dashboard.js';

const DEBUG = true;

const DESIRE = Object.freeze({
    DELIVER: 'delivering',
    PICKUP:  'picking_up',
    EXPLORE: 'exploring',
});

export class BdiAgent {
    constructor({ name, host, dashboardUrl }) {
        this.name         = name;
        this.host         = host;
        this.dashboardUrl = dashboardUrl?.replace(/\/$/, '') ?? null;

        this.world     = new WorldModel();
        this.io        = null;
        this.intention = { desire: DESIRE.EXPLORE, target: null };
    }

    // ── Setup ─────────────────────────────────────────────────────────────────

    async setup(token) {
        this.io = new ServerIO(this.host, token);

        const mapReady    = new Promise((res) => this.io.onMap((_w, _h, tiles) => { this.world.buildMap(tiles); res(); }));
        const youReady    = new Promise((res) => this.io.onYou((you) => { this.world.updateMe(you); res(); }));
        const configReady = new Promise((res) => {
            let done = false;
            this.io.on('config', (cfg) => { this.world.config = cfg ?? {}; if (!done) { done = true; res(); } });
            setTimeout(() => { if (!done) { done = true; res(); } }, 2000);
        });

        this.io.onParcels((ps)    => this.world.updateParcels(ps));
        this.io.onAgents((agents) => { this.world.others = agents; });

        await Promise.all([mapReady, youReady, configReady]);

        if (!this.world.map)   throw new Error(`[${this.name}] map never arrived`);
        if (!this.world.me.id) throw new Error(`[${this.name}] you-event never arrived`);

        console.log(`🤖 [${this.name}] connected as ${this.world.me.name ?? this.world.me.id}`);
    }

    // ── Loop ──────────────────────────────────────────────────────────────────

    async loop() {
        if (!this.world.map || !this.world.me.id) return;

        // 1. Revise beliefs (live via events — nothing to do here)
        // 2. Generate desires
        const desires = this._generateDesires();
        // 3. Select best intention
        this._selectIntention(desires);
        // 4. Execute one step
        await this._executeIntention();
    }

    // ── BDI internals (to be implemented) ────────────────────────────────────

    _generateDesires()          { return []; /* TODO */ }
    _selectIntention(desires)   { /* TODO */ }
    async _executeIntention()   { /* TODO */ }

    log(tag, msg) { if (DEBUG) console.log(`[${this.name}][${tag}] ${msg}`); }
}