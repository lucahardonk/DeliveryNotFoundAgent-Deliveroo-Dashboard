/**
 * Adapts the fire-and-forget {@link DeliverooClient} event callbacks into
 * one-shot Promises for the initial handshake, while keeping the underlying
 * listeners active for subsequent updates.
 *
 * The `once*` helpers resolve on the first event but the SDK keeps calling the
 * handler afterwards (e.g. `onceYou` keeps updating the self-position on every
 * later `you` event). `onSensing` / `onInfo` are plain continuous
 * subscriptions.
 */
export class SocketEventAdapter {
    /** @param {import("./DeliverooClient.js").DeliverooClient} client */
    constructor(client) {
        this.client = client;
    }

    /**
     * Resolves when the static map is first received.
     * @param {(width:number, height:number, tiles:any[]) => void} handler
     * @returns {Promise<void>}
     */
    onceMap(handler) {
        return new Promise((resolve) => {
            this.client.onMap((width, height, tiles) => {
                handler(width, height, tiles);
                resolve();
            });
        });
    }

    /**
     * Resolves on the first `you` event; handler keeps running afterwards.
     * @param {(you:object) => void} handler
     * @returns {Promise<void>}
     */
    onceYou(handler) {
        return new Promise((resolve) => {
            this.client.onYou((you) => {
                handler(you);
                resolve();
            });
        });
    }

    /**
     * Resolves on the first `config` event.
     * @param {(config:object) => void} handler
     * @returns {Promise<void>}
     */
    onceConfig(handler) {
        return new Promise((resolve) => {
            this.client.on('config', (config) => {
                handler(config);
                resolve();
            });
        });
    }

    /**
     * Resolves on the first `info` tick; handler keeps running afterwards.
     * @param {(info:object) => void} handler
     * @returns {Promise<void>}
     */
    onceInfo(handler) {
        return new Promise((resolve) => {
            this.client.on('info', (info) => {
                handler(info);
                resolve();
            });
        });
    }

    /** Continuous sensing subscription. @param {(sensing:object) => void} handler */
    onSensing(handler) {
        this.client.onSensing(handler);
    }

    /** Continuous info subscription. @param {(info:object) => void} handler */
    onInfo(handler) {
        this.client.on('info', handler);
    }
}
