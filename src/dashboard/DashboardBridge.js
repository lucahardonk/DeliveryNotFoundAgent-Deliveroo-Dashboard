import { EventEmitter } from 'node:events';

/**
 * Singleton bridge between the running agents and the dashboard server.
 *
 * Agents call {@link DashboardBridge#registerAgent} once and then push
 * serializable snapshots via {@link DashboardBridge#update}. The bridge keeps
 * the latest snapshot per agent (plus a cumulative parcel-sighting heatmap) and
 * emits an `"update"` event that the SSE endpoint forwards to the browser.
 *
 * The singleton pattern relies on the Node.js ES module cache: every
 * `import { bridge } from './DashboardBridge.js'` returns the exact same
 * instance, so no IPC or global state is required.
 */
class DashboardBridge extends EventEmitter {
    /** @type {Map<string, object>} agentId -> latest snapshot */
    #states = new Map();

    /**
     * Registers an agent and initializes its per-agent state, including a
     * zeroed heatmap matrix sized to the world map (width x height).
     * @param {string} agentId
     * @param {{width:number,height:number,tiles:any[][]}} worldMap
     */
    registerAgent(agentId, worldMap) {
        const width = worldMap?.width ?? 0;
        const height = worldMap?.height ?? 0;
        const heatmap = Array.from({ length: width }, () =>
            new Array(height).fill(0)
        );
        this.#states.set(agentId, {
            agentId,
            worldMap,
            heatmap,
            sensedParcels: [],
            sensedAgents: [],
            currentPath: [],
        });
    }

    /**
     * Stores the latest snapshot for an agent, updates the cumulative parcel
     * sighting heatmap (with a small decay so old data fades), and emits an
     * `"update"` event.
     * @param {string} agentId
     * @param {object} snapshot
     */
    update(agentId, snapshot) {
        const previous = this.#states.get(agentId);
        const width = snapshot?.worldMap?.width ?? previous?.worldMap?.width ?? 0;
        const height = snapshot?.worldMap?.height ?? previous?.worldMap?.height ?? 0;

        // Carry over the existing heatmap, or start a fresh one.
        let heatmap = previous?.heatmap;
        if (!heatmap || heatmap.length !== width) {
            heatmap = Array.from({ length: width }, () =>
                new Array(height).fill(0)
            );
        }

        // Apply a small decay factor so stale sightings fade over time.
        const DECAY = 0.995;
        for (let x = 0; x < heatmap.length; x++) {
            const col = heatmap[x];
            for (let y = 0; y < col.length; y++) {
                col[y] *= DECAY;
            }
        }

        // Increment each currently sensed parcel tile's counter.
        const parcels = snapshot?.sensedParcels ?? [];
        for (const parcel of parcels) {
            if (heatmap[parcel.x]?.[parcel.y] !== undefined) {
                heatmap[parcel.x][parcel.y] += 1;
            }
        }

        // Store the snapshot with the maintained heatmap attached.
        const merged = { ...snapshot, agentId, heatmap };
        this.#states.set(agentId, merged);

        this.emit('update', { agentId, snapshot: merged });
    }

    /**
     * Returns the full map of agentId -> latest snapshot.
     * @returns {Map<string, object>}
     */
    getState() {
        return this.#states;
    }
}

export const bridge = new DashboardBridge();
