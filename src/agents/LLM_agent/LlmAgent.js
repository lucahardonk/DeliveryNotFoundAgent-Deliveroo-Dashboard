// ─────────────────────────────────────────────────────────────────────────────
// LLMAgent — minimal agent that prints world state and can navigate via A*.
//
// Thin orchestrator: wires up setup + the main loop. All decision/navigation
// logic lives in functions.js.
// ─────────────────────────────────────────────────────────────────────────────

import { WorldModel } from './WorldModel.js';
import { ServerIO }   from './ServerIO.js';
import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';
import {
    log,
    printWorldState,
    think,
    stepToward,
    actOnTile,
} from './functions.js';

const STATE = Object.freeze({
    IDLE:       'idle',
    NAVIGATING: 'navigating',
});

export class LlmAgent {
    /**
     * @param {{ name: string, host: string }} cfg
     */
    constructor({ name, host }) {
        this.name  = name;
        this.host  = host;
        this.STATE = STATE;

        this.world  = new WorldModel();
        this.io     = null;
        /** @type {typeof STATE[keyof typeof STATE]} */
        this.state  = STATE.IDLE;
        this.target = null;   // { x, y } current navigation goal
    }

    // ── Setup ──────────────────────────────────────────────────────────────────

    async setup(token) {
        log(this.name, 'setup', `host=${this.host} token=${token.slice(0, 10)}…`);

        const client = DjsConnect(this.host, token);
        this.io      = new ServerIO(client, this.name);

        const mapReady = new Promise((resolve) => {
            client.onMap((_w, _h, rawTiles) => {
                if (rawTiles?.length) this.world.buildMap(rawTiles);
                resolve();
            });
        });

        const youReady = new Promise((resolve) => {
            client.onYou((you) => {
                this.world.updateMe(you);
                resolve();
            });
        });

        this.io.hookParcels((ps) => this.world.updateParcels(ps));
        this.io.hookAgents((agents) => { this.world.others = agents; });

        log(this.name, 'setup', 'waiting for map + you…');
        await Promise.all([mapReady, youReady]);

        if (!this.world.map)   throw new Error(`[${this.name}] map never arrived — check HOST`);
        if (!this.world.me.id) throw new Error(`[${this.name}] you-event never arrived — bad token?`);

        const { width, height } = this.world.map;
        log(this.name, 'setup', `READY  map=${width}x${height}`);
        console.log(`🤖 [${this.name}] connected at (${this.world.me.x},${this.world.me.y})`);
    }

    // ── Main loop ────────────────────────────────────────────────────────────────

    async loop() {
        if (!this.world.map || !this.world.me.id) {
            log(this.name, 'loop', 'SKIP — not ready');
            return;
        }

        printWorldState(this);

        // Try to act on the current tile first (pickup / delivery).
        if (await actOnTile(this)) {
            this.target = null;
            return;
        }

        // Decide where to go.
        this.target = think(this);
        if (!this.target) {
            this.state = STATE.IDLE;
            log(this.name, 'loop', 'nothing to do — idle');
            return;
        }

        // Already on target tile? act again next loop.
        if (this.world.isAt(this.target)) {
            await actOnTile(this);
            this.target = null;
            return;
        }

        // Navigate one step.
        this.state = STATE.NAVIGATING;
        const moved = await stepToward(this, this.target);
        if (!moved) this.target = null;
    }
}