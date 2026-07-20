/**
 * Holds the agent's latest sensing data: parcels and agents currently in view,
 * plus long-lived per-entity memory maps. Updated on every server `sensing`
 * event.
 *
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOParcel.js").IOParcel} IOParcel
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOAgent.js").IOAgent} IOAgent
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOCrate.js").IOCrate} IOCrate
 */
export class PerceptionStore {
    /** @type {IOParcel[]} */
    sensedParcels = [];
    /** @type {IOAgent[]} */
    sensedAgents = [];

    /** @type {Map<string, IOAgent[]>} */
    agentsMap = new Map();
    /** @type {Map<string, IOParcel>} */
    parcelsMap = new Map();
    /** @type {Map<string, IOCrate>} */
    cratesMap = new Map();

    /**
     * Replaces the currently-sensed parcels and agents from a `sensing` event.
     * Agent coordinates are snapped to integer tiles (the server emits
     * fractional coords mid-move).
     *
     * @param {{parcels: IOParcel[], agents: IOAgent[]}} sensing
     * @param {{roundAgents?: boolean}} [options]
     */
    updateFromSensing(sensing, { roundAgents = true } = {}) {
        this.sensedParcels = sensing.parcels;
        this.sensedAgents = sensing.agents ?? [];

        if (roundAgents) {
            this.sensedAgents.forEach(agent => {
                agent.x = Math.round(agent.x);
                agent.y = Math.round(agent.y);
            });
        }
    }
}
