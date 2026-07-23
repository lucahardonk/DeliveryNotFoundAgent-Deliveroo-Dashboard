import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import { WorldModel } from './WorldModel.js';
import { ServerIO }   from './ServerIO.js';
import { decide, postReport, log } from './functions.js';

const DEBUG = true;

const STATE = Object.freeze({
    EXPLORING:  'exploring',
    PICKING_UP: 'picking_up',
    DELIVERING: 'delivering',
});

export class GreedyAgent {
    /**
     * @param {{ name: string, host: string, dashboardUrl?: string, exploreRadius?: number }} cfg
     */
    constructor({ name, host, dashboardUrl, exploreRadius = 10 }) {
        this.name          = name;
        this.host          = host;
        this.dashboardUrl  = dashboardUrl?.replace(/\/$/, '') ?? null;
        this.exploreRadius = exploreRadius;
        this.STATE         = STATE;

        this.world        = new WorldModel();
        this.io           = null;
        this.state        = STATE.EXPLORING;
        this.searchTarget = null;
    }

    async setup(token) {
        log(this.name, 'setup', `host=${this.host} token=${token.slice(0, 10)}…`);

        const client = DjsConnect(this.host, token);
        this.io      = new ServerIO(client, this.name);

        const mapReady = new Promise((resolve) => {
            client.onMap((_w, _h, rawTiles) => {
                log(this.name, 'event:map', `${rawTiles?.length ?? 0} tiles received`);
                if (rawTiles?.length) this.world.buildMap(rawTiles);
                resolve();
            });
        });

        const youReady = new Promise((resolve) => {
            client.onYou((you) => {
                this.world.updateMe(you);
                log(this.name, 'event:you', `id=${this.world.me.id} pos=(${this.world.me.x},${this.world.me.y})`);
                resolve();
            });
        });

        const configReady = new Promise((resolve) => {
            let done = false;
            client.on('config', (cfg) => {
                this.world.config = cfg ?? {};
                log(this.name, 'event:config', JSON.stringify(cfg));
                if (!done) { done = true; resolve(); }
            });
            setTimeout(() => {
                if (!done) {
                    done = true;
                    log(this.name, 'event:config', 'no config after 2 s — continuing');
                    resolve();
                }
            }, 2000);
        });

        this.io.hookParcels((ps) => {
            log(this.name, 'event:parcels', `${ps.length} parcels`);
            this.world.updateParcels(ps);
        });

        this.io.hookAgents((agents) => { this.world.others = agents; });

        log(this.name, 'setup', 'waiting for map + you + config…');
        await Promise.all([mapReady, youReady, configReady]);

        if (!this.world.map)   throw new Error(`[${this.name}] map never arrived — check HOST`);
        if (!this.world.me.id) throw new Error(`[${this.name}] you-event never arrived — bad token?`);

        const { width, height, deliveryTiles, spawnerTiles } = this.world.map;
        log(this.name, 'setup', `READY  map=${width}x${height}  delivery=${deliveryTiles.length}  spawners=${spawnerTiles.length}`);
        console.log(`🤖 [${this.name}] connected as ${this.world.me.name ?? this.world.me.id} at (${this.world.me.x},${this.world.me.y})`);

        await postReport(this, 'ready', 'connected');
    }

    async loop() {
        // Skip if world model is not yet initialised
        if (!this.world.map || !this.world.me.id) {
            log(this.name, 'loop', 'SKIP — not ready');
            return;
        }

        // Log current state snapshot for debugging
        log(this.name, 'loop',
            `state=${this.state}` +
            `  pos=(${this.world.me.x},${this.world.me.y})` +
            `  carrying=${this.world.carrying().length}` +
            `  freeParcels=${this.world.freeParcels().length}`
        );

        // Run the decision logic and get a description of the chosen action
        //main action
        const action = await decide(this);

        // Log the outcome and push a status update to the dashboard
        log(this.name, 'loop', `→ ${action}`);
        await postReport(this, this.state, action);
    }
}