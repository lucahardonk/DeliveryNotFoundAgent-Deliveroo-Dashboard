import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.join(__dirname, 'memory.txt');

function readMemory() {
    if (!existsSync(MEMORY_FILE)) return '';
    return readFileSync(MEMORY_FILE, 'utf-8');
}

function buildWorldSnapshot(agent) {
    const { world } = agent;

    return {
        map: world.map
            ? {
                width: world.map.width,
                height: world.map.height,
                deliveryTiles: world.map.deliveryTiles,
                spawnerTiles:  world.map.spawnerTiles,
            }
            : null,

        me: {
            x: world.me.x,
            y: world.me.y,
            score: world.me.score,
        },

        carrying: world.carrying().map((p) => ({ id: p.id, x: p.x, y: p.y })),
        freeParcels: world.freeParcels().map((p) => ({ id: p.id, x: p.x, y: p.y })),

        others: world.others.map((a) => ({ id: a.id, x: a.x, y: a.y })),
    };
}

export function buildPrompt(agent, text) {
    return {
        memory: readMemory(),
        world: buildWorldSnapshot(agent),
        chat: text,
    };
}