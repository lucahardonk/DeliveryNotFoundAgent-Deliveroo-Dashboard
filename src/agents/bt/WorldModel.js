import { buildMap, TILE } from './MapModel.js';

/**
 * Single source of truth for everything the agent knows about the world.
 * Updated by sensing events; queried by BtAgent during deliberation.
 */
export class WorldModel {
    constructor() {
        this.map     = null;        // built once from the map event
        this.config  = {};          // server config (CLOCK, penalties, …)
        this.me      = { id: null, name: null, x: 0, y: 0, score: 0 };
        /** @type {Map<string,object>} parcelId → parcel */
        this.parcels = new Map();
        /** @type {object[]} other agents currently sensed */
        this.others  = [];
    }

    // ── Updaters (called by ServerIO hooks) ──────────────────────────────────

    buildMap(rawTiles) {
        this.map = buildMap(rawTiles);
    }

    updateMe(you) {
        if (!you) return;
        this.me.id    = you.id;
        this.me.name  = you.name;
        this.me.x     = Math.round(you.x);
        this.me.y     = Math.round(you.y);
        this.me.score = you.score ?? this.me.score;
    }

    updateParcels(sensed) {
        const seen = new Set();
        for (const p of sensed) {
            seen.add(p.id);
            this.parcels.set(p.id, { ...p, x: Math.round(p.x), y: Math.round(p.y) });
        }
        const range = this.config?.PARCELS_OBSERVATION_DISTANCE ?? 5;
        for (const [id, p] of this.parcels) {
            const inView = Math.abs(p.x - this.me.x) + Math.abs(p.y - this.me.y) <= range;
            if (!seen.has(id) && inView) this.parcels.delete(id);
        }
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    carrying()     { return [...this.parcels.values()].filter((p) => p.carriedBy === this.me.id); }
    freeParcels()  { return [...this.parcels.values()].filter((p) => !p.carriedBy); }
    blockedTiles() { return this.others.map((a) => ({ x: Math.round(a.x), y: Math.round(a.y) })); }

    atDelivery() {
        return this.map?.tiles?.[this.me.x]?.[this.me.y] === TILE.delivery;
    }

    parcelHere() {
        return this.freeParcels().find((p) => p.x === this.me.x && p.y === this.me.y) ?? null;
    }

    walkable(x, y) {
        if (!this.map) return false;
        if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
        return this.map.tiles[x]?.[y] != null && this.map.tiles[x][y] !== TILE.wall;
    }
}