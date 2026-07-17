/**
 * Typed wrapper around the raw `IOGameOptions` object emitted by the server on
 * the `config` event. Centralises the (sometimes deeply nested) option lookups
 * behind named getters so strategy code stays readable.
 *
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOGameOptions.js").IOGameOptions} IOGameOptions
 */
export class GameConfig {
    /** @type {IOGameOptions} */
    #raw = {};

    /**
     * Replaces the stored config with a fresh one from the server.
     * @param {IOGameOptions} config
     */
    set(config) {
        this.#raw = config ?? {};
    }

    /** @returns {IOGameOptions} the underlying raw options object. */
    get raw() {
        return this.#raw;
    }

    /** Milliseconds per game tick / move step. */
    get clock() {
        return this.#raw.CLOCK ?? 0;
    }

    /** Milliseconds between each -1 parcel reward decay (Infinity = no decay). */
    get decayInterval() {
        return this.#raw?.GAME?.parcels?.decaying_event ?? Infinity;
    }

    /** How far (in tiles) an agent can sense. */
    get observationDistance() {
        return this.#raw?.GAME?.player?.observation_distance;
    }

    /** Legacy flat decay interval used by some heuristics; defaults to 1000. */
    get parcelDecayInterval() {
        return this.#raw.parcelDecayInterval ?? 1000;
    }
}
