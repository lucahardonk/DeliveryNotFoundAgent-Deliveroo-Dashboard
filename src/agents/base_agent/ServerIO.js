// ─────────────────────────────────────────────────────────────────────────────
// ServerIO — wraps every interaction with the @unitn-asa/deliveroo-js-sdk.
//
// Responsibilities:
//   1. Wire up continuous sensing events (parcels, agents).
//   2. Emit action commands (move, pickup, putdown) and await their callbacks.
//
// Why separate?  If the SDK API changes (e.g. emitMove → move) you fix it
// here only, without touching any agent logic.
// ─────────────────────────────────────────────────────────────────────────────

export class ServerIO {
    /**
     * @param {object} client  The DjsConnect client instance.
     * @param {string} name    Agent name — used only for error messages.
     */
    constructor(client, name) {
        this.client = client;
        this.name   = name;
    }

    // ── Sensing ───────────────────────────────────────────────────────────────

    /**
     * Registers the parcel sensing callback.
     *
     * The SDK exposes two possible APIs depending on the version:
     *   - onParcelsSensing(cb)   newer, dedicated
     *   - onSensing(cb)          older, combined (parcels + agents in one event)
     *
     * We prefer the dedicated API and fall back gracefully.
     *
     * @param {(parcels: object[]) => void} onParcels
     */
    hookParcels(onParcels) {
        if (typeof this.client.onParcelsSensing === 'function') {
            this.client.onParcelsSensing((ps) => onParcels(ps ?? []));
        } else if (typeof this.client.onSensing === 'function') {
            this.client.onSensing((s) => onParcels(s?.parcels ?? s ?? []));
        } else {
            console.warn(`[${this.name}] WARNING: no parcel sensing API found on client`);
        }
    }

    /**
     * Registers the other-agents sensing callback.
     *
     * @param {(agents: object[]) => void} onAgents
     */
    hookAgents(onAgents) {
        if (typeof this.client.onAgentsSensing === 'function') {
            this.client.onAgentsSensing((agents) => onAgents(agents ?? []));
        } else if (typeof this.client.onSensing === 'function') {
            // onSensing is shared; call hookParcels first so both callbacks fire.
            this.client.onSensing((s) => onAgents(s?.agents ?? []));
        }
        // No warning — agent sensing is optional.
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    /**
     * Sends a move command and waits for the server acknowledgement.
     *
     * The SDK may expose either:
     *   - client.emitMove(dir) -> Promise    (newer)
     *   - client.emit('move', dir, callback) (older socket.io style)
     *
     * Returns the server response (truthy = success, falsy = failed/blocked).
     *
     * @param {'right'|'left'|'up'|'down'} dir
     */
    async doMove(dir) {
        try {
            return typeof this.client.emitMove === 'function'
                ? await this.client.emitMove(dir)
                : await new Promise((r) => this.client.emit('move', dir, r));
        } catch (e) {
            console.error(`[${this.name}] move error:`, e?.message ?? e);
            return false;
        }
    }

    /**
     * Picks up all parcels on the current tile.
     * The server returns an array of picked-up parcel ids (empty = nothing picked up).
     */
    async doPickup() {
        try {
            const res = typeof this.client.emitPickup === 'function'
                ? await this.client.emitPickup()
                : await new Promise((r) => this.client.emit('pickup', r));

            // res is either an array of picked-up parcel ids, or a truthy/falsy value.
            return Boolean(res && (Array.isArray(res) ? res.length : true));
        } catch (e) {
            console.error(`[${this.name}] pickup error:`, e?.message ?? e);
            return false;
        }
    }

    /**
     * Drops all carried parcels on the current tile.
     * Only meaningful on delivery tiles — the server awards points then.
     */
    async doPutdown() {
        try {
            const res = typeof this.client.emitPutdown === 'function'
                ? await this.client.emitPutdown()
                : await new Promise((r) => this.client.emit('putdown', r));
            return Boolean(res);
        } catch (e) {
            console.error(`[${this.name}] putdown error:`, e?.message ?? e);
            return false;
        }
    }
}