import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';

/**
 * Thin, stable wrapper around the Deliveroo JS SDK socket.
 *
 * The rest of the codebase only ever touches this small surface
 * (event registration + move / pickup / putdown / shout) instead of the raw
 * SDK socket, so the SDK can be swapped without touching agent logic.
 *
 * One client == one socket == one agent (one token). This is what lets `main.js`
 * spawn several independent agents in the same process, one per token.
 */
export class DeliverooClient {
    /**
     * @param {object} [options]
     * @param {string} [options.token] - auth token (defaults to process.env.TOKEN).
     * @param {string} [options.host]  - server URL (defaults to process.env.HOST).
     */
    constructor({ token, host } = {}) {
        this.socket = DjsConnect(host || process.env.HOST, token || process.env.TOKEN);
    }

    // ── Event registration ──────────────────────────────────────────────────
    /** @param {(width:number, height:number, tiles:any[]) => void} cb */
    onMap(cb) { this.socket.onMap(cb); }

    /** @param {(you:object) => void} cb */
    onYou(cb) { this.socket.onYou(cb); }

    /**
     * Subscribe to parcel sensing. Supports both the combined `onSensing`
     * SDK and the split `onParcelsSensing` SDK.
     * @param {(parcels:any[]) => void} cb
     */
    onParcelsSensing(cb) {
        if (typeof this.socket.onParcelsSensing === 'function') {
            this.socket.onParcelsSensing(cb);
        } else if (typeof this.socket.onSensing === 'function') {
            this.socket.onSensing((sensing) => cb(sensing?.parcels ?? sensing ?? []));
        }
    }

    /**
     * Subscribe to other-agents sensing.
     * @param {(agents:any[]) => void} cb
     */
    onAgentsSensing(cb) {
        if (typeof this.socket.onAgentsSensing === 'function') {
            this.socket.onAgentsSensing(cb);
        } else if (typeof this.socket.onSensing === 'function') {
            this.socket.onSensing((sensing) => cb(sensing?.agents ?? []));
        }
    }

    /** Generic event subscription (e.g. "config"). */
    on(event, cb) { this.socket.on(event, cb); }

    // ── Actions ───────────────────────────────────────────────────────────────
    /**
     * Promisified move; resolves with the server ack (truthy on success).
     * @param {'up'|'down'|'left'|'right'} direction
     * @returns {Promise<object|false>}
     */
    move(direction) {
        if (typeof this.socket.emitMove === 'function') return this.socket.emitMove(direction);
        return new Promise((resolve) => this.socket.emit('move', direction, resolve));
    }

    /** @returns {Promise<any>} */
    pickup() {
        if (typeof this.socket.emitPickup === 'function') return this.socket.emitPickup();
        return new Promise((resolve) => this.socket.emit('pickup', resolve));
    }

    /** @returns {Promise<any>} */
    putdown() {
        if (typeof this.socket.emitPutdown === 'function') return this.socket.emitPutdown();
        return new Promise((resolve) => this.socket.emit('putdown', resolve));
    }

    /** @param {string} message @returns {Promise<any>} */
    shout(message) {
        if (typeof this.socket.emitShout === 'function') return this.socket.emitShout(message);
        return new Promise((resolve) => this.socket.emit('shout', message, resolve));
    }
}
