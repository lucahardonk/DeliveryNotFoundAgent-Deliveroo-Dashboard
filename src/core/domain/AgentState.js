/**
 * Mutable "self" belief — the agent's own latest position/score as reported by
 * the server `you` event. Server events sometimes carry fractional coordinates
 * mid-move, so positions are rounded to the nearest tile on every update.
 *
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOAgent.js").IOAgent} IOAgent
 * @typedef {import("./Position.js").TilePosition} TilePosition
 */
export class AgentState {
    /** @type {IOAgent} */
    #me = {};

    /**
     * Updates the stored self-state from a `you` event, snapping coordinates to
     * integer tile positions.
     * @param {IOAgent} you
     */
    update(you) {
        you.x = Math.round(you.x);
        you.y = Math.round(you.y);
        this.#me = you;
    }

    /** @returns {IOAgent} the raw self object. */
    get me() {
        return this.#me;
    }

    get id() {
        return this.#me.id;
    }

    get name() {
        return this.#me.name;
    }

    get x() {
        return this.#me.x;
    }

    get y() {
        return this.#me.y;
    }

    /** @returns {TilePosition} */
    get position() {
        return { x: this.#me.x, y: this.#me.y };
    }
}
