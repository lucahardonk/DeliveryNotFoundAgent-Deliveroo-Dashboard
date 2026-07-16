import { EventEmitter } from 'node:events';

class DashboardBridge extends EventEmitter {
    #agents = new Map();

    registerAgent(agentId, worldMap) {
        const height = worldMap.length;
        const width = worldMap[0].length;
        const heatmap = Array.from({ length: height }, () => Array(width).fill(0));
        
        this.#agents.set(agentId, {
            snapshot: null,
            heatmap
        });
    }

    update(agentId, snapshot) {
        const agent = this.#agents.get(agentId);
        if (!agent) return;

        agent.snapshot = snapshot;

        // Update heatmap from sensed parcels
        if (snapshot.sensedParcels) {
            for (const p of snapshot.sensedParcels) {
                const y = Math.floor(p.y);
                const x = Math.floor(p.x);
                if (y >= 0 && y < agent.heatmap.length && x >= 0 && x < agent.heatmap[0].length) {
                    agent.heatmap[y][x] += 1;
                }
            }
        }

        // Apply decay
        for (let y = 0; y < agent.heatmap.length; y++) {
            for (let x = 0; x < agent.heatmap[y].length; x++) {
                agent.heatmap[y][x] *= 0.995;
            }
        }

        this.emit('update', agentId, { ...snapshot, heatmap: agent.heatmap });
    }

    getState() {
        const state = new Map();
        for (const [id, agent] of this.#agents.entries()) {
            if (agent.snapshot) {
                state.set(id, { ...agent.snapshot, heatmap: agent.heatmap });
            }
        }
        return state;
    }
}

export const bridge = new DashboardBridge();
