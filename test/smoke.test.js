/**
 * Smoke tests — no real Deliveroo server required.
 *
 * Validates:
 *   1. grid.js pure logic (buildMap, bfs, nearestReachable);
 *   2. the shared AgentCore beliefs/capabilities via an injected mock client;
 *   3. each strategy takes a sensible first action;
 *   4. state actually reaches the standalone dashboard over its REST API.
 *
 * Run with: npm test
 */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { buildMap, bfs, nearestReachable, TILE } from '../src/agents/bdi/grid.js';
import { BaseGreedyAgent } from '../src/agents/base_agent/BaseGreedyAgent.js';
import { BtAgent } from '../src/agents/bt/BtAgent.js';
import { BdiAgent } from '../src/agents/bdi/BdiAgent.js';

let passed = 0;
const ok = (name) => { console.log(`  ✅ ${name}`); passed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A tiny 5x5 all-walkable map, delivery at (0,0), spawner at (4,4) ────────
function makeTiles() {
    const tiles = [];
    for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
            let type = TILE.walkable;
            if (x === 0 && y === 0) type = TILE.delivery;
            if (x === 4 && y === 4) type = TILE.spawner;
            tiles.push({ x, y, type });
        }
    }
    return tiles;
}

/** Mock of the DeliverooClient surface AgentCore uses. */
class MockClient {
    constructor(parcels = []) {
        this.pos = { x: 2, y: 2 };
        this.parcels = parcels;
        this._you = null;
        this.moves = [];
        this.pickedUp = [];
    }
    onMap(cb) { cb(5, 5, makeTiles()); }
    onYou(cb) { this._you = cb; cb({ id: 'a1', name: 'A1', x: this.pos.x, y: this.pos.y, score: 0 }); }
    on(event, cb) { if (event === 'config') cb({ PARCELS_OBSERVATION_DISTANCE: 5 }); }
    onParcelsSensing(cb) { this._parcelCb = cb; cb(this.parcels); }
    onAgentsSensing(cb) { cb([]); }
    async move(dir) {
        this.moves.push(dir);
        if (dir === 'up') this.pos.y++;
        if (dir === 'down') this.pos.y--;
        if (dir === 'right') this.pos.x++;
        if (dir === 'left') this.pos.x--;
        if (this._you) this._you({ id: 'a1', name: 'A1', x: this.pos.x, y: this.pos.y, score: 0 });
        return { ...this.pos };
    }
    async pickup() {
        const here = this.parcels.filter((p) => p.x === this.pos.x && p.y === this.pos.y && !p.carriedBy);
        here.forEach((p) => { p.carriedBy = 'a1'; });
        if (this._parcelCb) this._parcelCb(this.parcels);
        this.pickedUp.push(...here);
        return here.map((p) => ({ id: p.id }));
    }
    async putdown() {
        const carried = this.parcels.filter((p) => p.carriedBy === 'a1');
        carried.forEach((p) => { p.carriedBy = null; p.delivered = true; });
        return carried.map((p) => ({ id: p.id }));
    }
}

async function testGrid() {
    console.log('grid.js');
    const map = buildMap(makeTiles());
    assert.strictEqual(map.width, 5);
    assert.strictEqual(map.height, 5);
    assert.deepStrictEqual(map.deliveryTiles, [{ x: 0, y: 0 }]);
    assert.deepStrictEqual(map.spawnerTiles, [{ x: 4, y: 4 }]);
    ok('buildMap derives dimensions + delivery/spawner tiles');

    const r = bfs(map, { x: 2, y: 2 }, { x: 2, y: 4 });
    assert.strictEqual(r.dist, 2);
    assert.strictEqual(r.firstStep, 'up'); // y increases => 'up'
    ok('bfs finds shortest path + correct first step');

    const wallTiles = makeTiles().map((t) => (t.x === 1 && t.y >= 0 && t.y <= 3 ? { ...t, type: TILE.wall } : t));
    const wmap = buildMap(wallTiles);
    const around = bfs(wmap, { x: 0, y: 0 }, { x: 2, y: 0 });
    assert.ok(around && around.dist > 2, 'must detour around the wall');
    ok('bfs respects walls (detours)');

    const near = nearestReachable(map, { x: 2, y: 2 }, [{ x: 4, y: 4 }, { x: 2, y: 3 }]);
    assert.deepStrictEqual(near.target, { x: 2, y: 3 });
    ok('nearestReachable picks the closest target');
}

async function testAgentCore() {
    console.log('AgentCore beliefs & capabilities');
    const client = new MockClient([{ id: 'p1', x: 2, y: 3, reward: 10 }]);
    const a = new BaseGreedyAgent({ client, dashboardUrl: 'http://127.0.0.1:1', label: 'T' });
    await a.connect();
    assert.strictEqual(a.map.width, 5);
    assert.strictEqual(a.me.id, 'a1');
    ok('connect() populates map + self beliefs');

    assert.strictEqual(a.freeParcels().length, 1);
    const np = a.nearestFreeParcel();
    assert.strictEqual(np.target.x, 2); assert.strictEqual(np.target.y, 3);
    ok('freeParcels + nearestFreeParcel work');

    await a.stepToward({ x: 2, y: 3 });
    assert.deepStrictEqual(client.moves.at(-1), 'up');
    ok('stepToward issues the correct move');
}

async function testStrategiesReachGoal() {
    console.log('strategies deliver a parcel (mock world)');
    for (const [name, Cls] of [['base', BaseGreedyAgent], ['bt', BtAgent], ['bdi', BdiAgent]]) {
        const client = new MockClient([{ id: 'p1', x: 2, y: 3, reward: 10 }]);
        const agent = new Cls({ client, dashboardUrl: 'http://127.0.0.1:1', label: name });
        await agent.connect();

        // Drive up to 40 ticks of the agent's own decision step.
        const step = name === 'bt'
            ? () => agent.tree(agent)
            : name === 'bdi'
                ? async () => {
                    const d = agent._generateDesires();
                    if (!agent._intentionStillValid()) agent.intention = d[0];
                    await agent._execute(agent.intention);
                }
                : () => agent._tick();

        let delivered = false;
        for (let i = 0; i < 40 && !delivered; i++) {
            await step();
            delivered = client.parcels.some((p) => p.delivered);
        }
        assert.ok(delivered, `${name} agent should pick up and deliver the parcel`);
        ok(`${name} agent picks up and delivers`);
    }
}

async function testDashboardIntegration() {
    console.log('dashboard REST integration');
    const port = 3999;
    const server = spawn('node', ['dashboard/server.js'], {
        env: { ...process.env, DASHBOARD_PORT: String(port) },
        stdio: 'ignore',
    });
    await sleep(800);
    try {
        const client = new MockClient([{ id: 'p1', x: 2, y: 3, reward: 10 }]);
        const agent = new BtAgent({ client, dashboardUrl: `http://localhost:${port}`, label: 'BT#1' });
        await agent.connect();
        await agent.reportState('running', 'unit-test');

        const res = await fetch(`http://localhost:${port}/api/agents`);
        const data = await res.json();
        const snap = data['a1'];
        assert.ok(snap, 'agent snapshot must be stored on the dashboard');
        assert.strictEqual(snap.type, 'bt');
        assert.strictEqual(snap.action, 'unit-test');
        ok('agent state reaches the dashboard via POST + GET');
    } finally {
        server.kill();
    }
}

(async () => {
    try {
        await testGrid();
        await testAgentCore();
        await testStrategiesReachGoal();
        await testDashboardIntegration();
        console.log(`\n🎉 All ${passed} checks passed.`);
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Test failed:', err);
        process.exit(1);
    }
})();
