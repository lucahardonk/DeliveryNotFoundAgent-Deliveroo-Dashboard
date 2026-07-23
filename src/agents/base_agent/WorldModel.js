// ─────────────────────────────────────────────────────────────────────────────
// WorldModel — maintains the agent's internal representation of the game world.
//
// Updated entirely by server events (map, you, parcels, agents).
// Never calls the SDK directly; the agent pushes data in via update*() methods.
// ─────────────────────────────────────────────────────────────────────────────

// Tile type constants as sent by the Deliveroo server.
export const TILE = Object.freeze({
    WALL:     '0',
    SPAWNER:  '1',  // parcels can appear here
    DELIVERY: '2',  // drop off parcels here to score points
    WALKABLE: '3',  // plain floor
});

export class WorldModel {
    constructor() {
        // Built once from the onMap event; never mutated after that.
        this.map = null;
        // {
        //   width, height,
        //   tiles: string[][],         tiles[x][y] = TILE constant
        //   deliveryTiles: {x,y}[],
        //   spawnerTiles:  {x,y}[],
        //   walkableTiles: {x,y}[],    all non-wall tiles
        // }

        // Updated on every onYou event.
        this.me = { id: null, name: null, x: 0, y: 0, score: 0 };

        // Merged parcel state: id -> parcel object.
        // Parcels are removed when they leave the agent's observation radius.
        this.parcels = new Map();

        // Latest snapshot of other agents visible to this agent.
        this.others = [];

        // Server config (CLOCK, PENALTY, observation_distance, etc.)
        this.config = {};
    }

    // ── Map ───────────────────────────────────────────────────────────────────

    /**
     * Converts the flat tile array from the SDK into an indexed 2-D structure.
     * Called once during setup when the onMap event fires.
     *
     * The SDK sends tiles as an array of { x, y, type } objects.
     * We index them as tiles[x][y] for O(1) access during pathfinding.
     */
    buildMap(rawTiles) {
        let W = 0, H = 0;
        for (const t of rawTiles) { W = Math.max(W, t.x); H = Math.max(H, t.y); }
        W++; H++; // dimensions are max-index + 1

        const tiles         = Array.from({ length: W }, () => new Array(H).fill(null));
        const deliveryTiles = [];
        const spawnerTiles  = [];
        const walkableTiles = [];

        for (const t of rawTiles) {
            const type = String(t.type);
            tiles[t.x][t.y] = type;

            if (type !== TILE.WALL)     walkableTiles.push({ x: t.x, y: t.y });
            if (type === TILE.DELIVERY) deliveryTiles.push({ x: t.x, y: t.y });
            if (type === TILE.SPAWNER)  spawnerTiles.push({ x: t.x, y: t.y });
        }

        this.map = { width: W, height: H, tiles, deliveryTiles, spawnerTiles, walkableTiles };
    }

    /**
     * Returns true if the cell (x, y) can be stepped on.
     * Used by astar() as its walkableFn callback.
     */
    walkable(x, y) {
        if (!this.map) return false;
        if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
        const t = this.map.tiles[x]?.[y];
        return t != null && t !== TILE.WALL;
    }

    // ── Agent ─────────────────────────────────────────────────────────────────

    /**
     * Merges a `you` payload from the server into this.me.
     * Coordinates are rounded because the server sends floats mid-movement.
     */
    updateMe(you) {
        if (!you) return;
        this.me.id    = you.id;
        this.me.name  = you.name;
        this.me.x     = Math.round(you.x);
        this.me.y     = Math.round(you.y);
        this.me.score = you.score ?? this.me.score;
    }

    // ── Parcels ───────────────────────────────────────────────────────────────

    /**
     * Merges the latest parcel sensing event into this.parcels.
     *
     * Strategy:
     *   - Any parcel the server reported this tick → upsert.
     *   - Any parcel NOT seen this tick but within observation range → remove
     *     (the server would have included it if it still existed).
     *   - Parcels outside observation range → keep (we may still remember them).
     */
    updateParcels(sensed) {
        const seen  = new Set();
        const range = this.config?.PARCELS_OBSERVATION_DISTANCE
                   ?? this.config?.player?.observation_distance
                   ?? 5;

        for (const p of sensed) {
            seen.add(p.id);
            this.parcels.set(p.id, {
                ...p,
                x: Math.round(p.x),
                y: Math.round(p.y),
            });
        }

        for (const [id, p] of this.parcels) {
            const dist   = Math.abs(p.x - this.me.x) + Math.abs(p.y - this.me.y);
            const inView = dist <= range;
            if (!seen.has(id) && inView) this.parcels.delete(id);
        }
    }

    // ── Convenience queries ───────────────────────────────────────────────────

    /** Parcels currently being carried by this agent. */
    carrying() {
        return [...this.parcels.values()].filter((p) => p.carriedBy === this.me.id);
    }

    /** Parcels on the ground that no one is carrying. */
    freeParcels() {
        return [...this.parcels.values()].filter((p) => !p.carriedBy);
    }

    /** A free parcel sitting on the agent's current tile (ready to pick up). */
    parcelHere() {
        return this.freeParcels().find(
            (p) => p.x === this.me.x && p.y === this.me.y,
        ) ?? null;
    }

    /** True if the agent is standing on a delivery tile. */
    atDelivery() {
        return this.map?.tiles?.[this.me.x]?.[this.me.y] === TILE.DELIVERY;
    }

    /** True if the agent is at position t. */
    isAt(t) {
        return this.me.x === t.x && this.me.y === t.y;
    }
}