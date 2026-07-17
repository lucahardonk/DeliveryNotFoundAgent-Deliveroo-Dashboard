import 'dotenv/config';
import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';

/**
 * Thin wrapper around the Deliveroo JS SDK socket connection.
 *
 * It exists so the rest of the platform depends on a small, stable surface
 * (move / pickup / putdown / shout + event registration) instead of the raw
 * SDK socket. `move` is promisified for convenient `await`ing.
 *
 * @typedef {import("../domain/Position.js").MoveDirection} MoveDirection
 */
export class DeliverooClient {
    /**
     * @param {object} [options]
     * @param {string} [options.token] - auth token; defaults to `process.env.TOKEN`.
     * @param {string} [options.host]  - server URL; defaults to `process.env.HOST`.
     */
    constructor({ token, host } = {}) {
        // DjsConnect(host, token, name) — fall back to env vars when omitted so a
        // single-token .env still works, while allowing one token per agent when
        // spawning several agents in the same process.
        this.socket = DjsConnect(host || process.env.HOST, token || process.env.TOKEN);
    }

    // ── Event registration ────────────────────────────────────────────────
    /** @param {(width:number, height:number, tiles:any[]) => void} cb */
    onMap(cb) { this.socket.onMap(cb); }

    /** @param {(you:object) => void} cb */
    onYou(cb) { this.socket.onYou(cb); }

    /** @param {(sensing:object) => void} cb */
    onSensing(cb) { this.socket.onSensing(cb); }

    /**
     * Generic event subscription (e.g. "info", "config").
     * @param {string} event
     * @param {(payload:any) => void} cb
     */
    on(event, cb) { this.socket.on(event, cb); }

    /** Low-level emit passthrough. */
    emit(...args) { return this.socket.emit(...args); }

    // ── Actions ───────────────────────────────────────────────────────────
    /**
     * Promisified move: resolves with the server's ack (truthy on success).
     * @param {MoveDirection} direction
     * @returns {Promise<object|false>}
     */
    move(direction) {
        return new Promise((resolve) => this.socket.emit('move', direction, resolve));
    }

    /** @returns {Promise<any>} */
    pickup() { return this.socket.emitPickup(); }

    /** @returns {Promise<any>} */
    putdown() { return this.socket.emitPutdown(); }

    /** @param {string} message @returns {Promise<any>} */
    shout(message) { return this.socket.emitShout(message); }
}
