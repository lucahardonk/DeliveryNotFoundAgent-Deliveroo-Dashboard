import { DjsConnect } from '@unitn-asa/deliveroo-js-sdk/client';

/**
 * Thin wrapper around the Deliveroo SDK socket.
 * Exposes event hooks and promisified actions; nothing else.
 */
export class ServerIO {
    constructor(host, token) {
        this._socket = DjsConnect(host, token);
    }

    // ── Event hooks ───────────────────────────────────────────────────────────

    onMap(cb)     { this._socket.onMap(cb); }
    onYou(cb)     { this._socket.onYou(cb); }
    on(event, cb) { this._socket.on(event, cb); }

    onParcels(cb) {
        if (typeof this._socket.onParcelsSensing === 'function')
            this._socket.onParcelsSensing(cb);
        else
            this._socket.onSensing?.((s) => cb(s?.parcels ?? s ?? []));
    }

    onAgents(cb) {
        if (typeof this._socket.onAgentsSensing === 'function')
            this._socket.onAgentsSensing(cb);
        else
            this._socket.onSensing?.((s) => cb(s?.agents ?? []));
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    move(dir) {
        if (typeof this._socket.emitMove === 'function') return this._socket.emitMove(dir);
        return new Promise((r) => this._socket.emit('move', dir, r));
    }

    pickup() {
        if (typeof this._socket.emitPickup === 'function') return this._socket.emitPickup();
        return new Promise((r) => this._socket.emit('pickup', r));
    }

    putdown() {
        if (typeof this._socket.emitPutdown === 'function') return this._socket.emitPutdown();
        return new Promise((r) => this._socket.emit('putdown', r));
    }
}