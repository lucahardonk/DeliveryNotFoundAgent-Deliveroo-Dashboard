import 'dotenv/config'
import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk/client";
import {PathFinder} from "#MultiAgentSystem/BDI_Agent/capabilities/Navigation/PathFinder.js";
import {MapAnalysis} from "#MultiAgentSystem/BDI_Agent/capabilities/Analysis/MapAnalysis.js";
import {TILE_TYPES} from "#types/world.js";
import { bridge } from '../dashboard/DashboardBridge.js';

/**
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOGameOptions.js").IOGameOptions} IOGameOptions
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOAgent.js").IOAgent} IOAgent
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOCrate.js").IOCrate} IOCrate
 * @typedef {import("#@unitn-asa/deliveroo-js-sdk/src/types/IOParcel.js").IOParcel} IOParcel
 * @typedef {import("#types/world.js").TilePosition} TilePosition
 * @typedef {import("#types/world.js").WorldMap} WorldMap
 * @typedef {import("#types/world.js").WorldSensing} WorldSensing
 * @typedef {import("#types/world.js").NavigationPath} NavigationPath
 * @typedef {import("#types/world.js").TileMoveTile} TileMoveTile
 */

const START_DELAY_MS = 1000;

export class BT_Agent {

    // ── Beliefs ───────────────────────────────────────────────────────────────

    /** @type {WorldMap} */
    #worldMap = { width: 0, height: 0, tiles: [] };
    /** @type {number[][]} */
    #sccMap = [];

    /** @type {WorldSensing} */
    #sensedWorld =  { width: 0, height: 0, tiles: [] };

    /** @type {Map<string, [IOAgent]>} */
    #agentsMap = new Map();
    /** @type {Map<string, IOParcel>} */
    #parcelsMap = new Map();
    /** @type {Map<string, IOCrate>} */
    #cratesMap = new Map();

    /** @type {IOTile[] } */
    #deliveryTiles = [];
    /** @type {IOTile[] } */
    #parcelSpawnerTiles = [];

    //TODO put 'me' inside sensedWorld
    /** @type {IOAgent} */
    #me = {};

    /** @type {IOParcel[]} */
    #sensedParcels = [];

    /** @type {IOAgent[]} */
    #sensedAgents = []

    /** @type {IOGameOptions} */
    #gameConfig = {};

    /** @type {number} */
    #elapsedTime = 0;

    /** @type {number[][]} — cumulative parcel sighting heatmap */
    #heatmap = [];



    // ── Intention execution ───────────────────────────────────────────────────

    /** @type {TileMoveTile[]} */
    #agentMovingActions = [];

    // ── Infrastructure ────────────────────────────────────────────────────────

    #socket = DjsConnect();
    #pathFinder = new PathFinder();
    #mapAnalysis = new MapAnalysis();

    // ── Initialization ────────────────────────────────────────────────────────

    /**
     * Waits for all initial beliefs to be populated from the server, then
     * computes derived beliefs and registers continuous listeners.
     * @returns {Promise<void>}
     */
    async #initialize() {
        await Promise.all([
            this.#waitForMap(),
            this.#waitForYou(),
            // this.#waitdForInfo(),
            this.#waitForConfig(),
        ]);

        console.log("Initial beliefs acquired");

        // Initialize heatmap and register with dashboard bridge
        this.#heatmap = Array.from({ length: this.#worldMap.width }, () =>
            new Array(this.#worldMap.height).fill(0)
        );
        bridge.registerAgent(this.#me.id, this.#worldMap);

        // Derived belief — computed once from the static map
        this.#sccMap = this.#mapAnalysis.stronglyConnectedComponents(this.#worldMap);
        console.log("Strongly Connected Components");
        console.table(this.#sccMap);

        // Sensing is a continuous listener, not a one-shot init Promise
        this.#socket.on("sensing", (sensing) => {
            // TODO: trigger intention reconsideration if the current planned path is affected
            console.log("Sensing update:", sensing);

            for (let position of sensing.positions) {
                this.#sensedWorld.tiles[position.x][position.y].updateTime = this.#elapsedTime
            }

            this.#sensedParcels = sensing.parcels;
            this.#sensedAgents = sensing.agents;
            this.#sensedAgents.forEach(agent => {agent.x = Math.round(agent.x); agent.y = Math.round(agent.y)});

            // Update heatmap with current parcel positions
            for (const parcel of sensing.parcels) {
                if (this.#heatmap[parcel.x]?.[parcel.y] !== undefined) {
                    this.#heatmap[parcel.x][parcel.y]++;
                }
            }
            // Push snapshot to dashboard bridge
            bridge.update(this.#me.id, this.#buildSnapshot());
        });

        this.#socket.on("info", (info) => {
            // console.log(info);
            this.#elapsedTime = info.ms;
        })


        console.log("All beliefs acquired — agent ready.");
    }

    /**
     * One-shot init Promise — resolves when the static map is received.
     * @returns {Promise<void>}
     */
    #waitForMap() {
        return new Promise((resolve) => {
            this.#socket.onMap((width, height, tiles) => {
                // XXX: server bug — reported width/height may be incorrect, derive from tile positions
                for (const tile of tiles) {
                    if (tile.x > this.#worldMap.width)  this.#worldMap.width  = tile.x;
                    if (tile.y > this.#worldMap.height) this.#worldMap.height = tile.y;
                }
                this.#worldMap.width++;
                this.#worldMap.height++;

                this.#sensedWorld.width = this.#worldMap.width
                this.#sensedWorld.height = this.#worldMap.height

                this.#worldMap.tiles = Array.from(
                    { length: this.#worldMap.width },
                    () => new Array(this.#worldMap.height).fill(null)
                );
                this.#sensedWorld.tiles = Array.from(
                    { length: this.#sensedWorld.width },
                    () => new Array(this.#sensedWorld.height).fill(null)
                );

                for (const tile of tiles) {
                    const tileType = String(tile.type);
                    this.#worldMap.tiles[tile.x][tile.y] = tileType;
                    this.#sensedWorld.tiles[tile.x][tile.y] = { updateTime: 0 };


                    switch (tileType) {
                        case TILE_TYPES.parcelSpawner: this.#parcelSpawnerTiles.push(tile); break;
                        case TILE_TYPES.delivery: this.#deliveryTiles.push(tile);      break;
                    }
                }

                console.table(this.#worldMap.tiles);
                resolve();
            });
        });
    }

    /**
     * Resolves on the first "you" event (initial position).
     * The listener stays active so that #me is updated on every subsequent position change.
     * @returns {Promise<void>}
     */
    #waitForYou() {
        return new Promise((resolve) => {
            this.#socket.onYou((you) => {
                // Skip half-step events — server emits fractional coords mid-move
                console.log(`You: ${you.x}, ${you.y}`);
                you.x = Math.round(you.x);
                you.y = Math.round(you.y);
                // if (!Number.isInteger(you.x) || !Number.isInteger(you.y)) return;
                this.#me = you;
                console.log("You are:", you);
                resolve(); // no-op after first call
            });
        });
    }

    /**
     * Resolves on the first "info" tick. The listener stays active for future ticks.
     * @returns {Promise<void>}
     */
    #waitForInfo() {
        return new Promise((resolve) => {
            this.#socket.on("info", (info) => {
                // TODO: store info.ms as last-sensed timestamp per tile
                resolve(); // no-op after first call
            });
        });
    }

    /**
     * One-shot init Promise — resolves when the game config is received.
     * @returns {Promise<void>}
     */
    #waitForConfig() {
        return new Promise((resolve) => {
            this.#socket.on("config", (config) => {
                this.#gameConfig = config;
                console.log("Game config:", config);
                resolve();
            });
        });
    }

    // ── Utils ─────────────────────────────────────────────────────────────────

    /** Builds a serializable snapshot of the agent's current state for the dashboard. */
    #buildSnapshot() {
        const dest = this.#agentMovingActions.length > 0
            ? this.#agentMovingActions.at(-1).to
            : null;
        return {
            agentId: this.#me.id,
            name: this.#me.name,
            x: this.#me.x,
            y: this.#me.y,
            score: this.#me.score,
            penalty: this.#me.penalty,
            worldMap: this.#worldMap,
            sccMap: this.#sccMap,
            deliveryTiles: this.#deliveryTiles,
            parcelSpawnerTiles: this.#parcelSpawnerTiles,
            sensedParcels: [...this.#sensedParcels],
            sensedAgents: [...this.#sensedAgents],
            currentPath: [...this.#agentMovingActions],
            destination: dest,
            heatmap: this.#heatmap,
            elapsedTime: this.#elapsedTime,
        };
    }

    async #resilientMove(direction, maxAttempts = 3) {
        const move = (direction) => new Promise((resolve) => this.#socket.emit("move", direction, resolve));

        for (let i = 0; i < maxAttempts; ++i) {
            console.log(`Moving ${direction} (attempt ${i + 1}/${maxAttempts})...`);
            const result = await move(direction);
            if (result) return result;

            console.log(`Move ${direction} failed (attempt ${i + 1}/${maxAttempts}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await this.#socket.emitShout(`Help! Blocked trying to move ${direction}`);
        console.error(`Move ${direction} failed after ${maxAttempts} attempts. Giving up.`);
        return null;
    }


    // ── Plans ─────────────────────────────────────────────────────────────────

    /**
     * Finds the shortest path to the closest reachable delivery tile.
     * Only tiles in the same SCC as the agent's current position are considered.
     * @param {IOTile[]} targetTiles
     * @param {IOTile} startTile
     * @returns {Promise<NavigationPath>}
     */
    // TODO: consider avoiding delivery tiles in areas crowded by other agents
    async #getPathToClosestTargetTiles(targetTiles, startTile = { x: this.#me.x, y: this.#me.y }) {

        // XXX: only targets in the same SCC are currently considered reachable.
        // TODO implement verification if it make sense to change SCC (for example in destination scc there are more spawning AND delivery tiles)
        const eligibleTiles = targetTiles.filter(
            (tile) => this.#sccMap[startTile.x][startTile.y] === this.#sccMap[tile.x][tile.y]
        );

        const paths = await Promise.all(
            eligibleTiles.map((tile) =>
                Promise.resolve(this.#pathFinder.aStar(this.#worldMap, startTile, { x: tile.x, y: tile.y }))
            )
        );

        return paths
            .filter((path) => path !== null)
            .reduce(
                (shortest, path) => path.distance < shortest.distance ? path : shortest,
                { distance: Infinity, path: [] }
            );
    }

    /** @param {NavigationPath} navigationPath */
    #loadIntentionActions(navigationPath) {
        // Erase old moving actions before loading new ones, to avoid conflicts and ensure the intention is up to date with the latest beliefs
        this.#agentMovingActions.length = 0;

        for (const step of navigationPath.path) {
            this.#agentMovingActions.push(step);
        }
    }



    // ── Behaviour Tree ─────────────────────────────────────────────────────────────
    #isOnDeliveryTile() {
        return this.#worldMap.tiles[this.#me.x][this.#me.y] === TILE_TYPES.delivery;
    }

    #isOnParcelTile() {
        return this.#sensedParcels.some(parcel => parcel.x === this.#me.x && parcel.y === this.#me.y && parcel.carriedBy == null);
    }

    /** @param {TilePosition} dest @return {boolean} */
    #destinationIsDeliveryTile(dest) {
        return this.#worldMap.tiles[dest.x][dest.y] === TILE_TYPES.delivery;
    }

    /** @param {TilePosition} dest @return {boolean} */
    #destinationIsParcelTile(dest) {
        return this.#sensedParcels.some(p => p.x === dest.x && p.y === dest.y);
    }

    /** @param {TilePosition} dest @return {boolean} */
    #destinationIsValidTile(dest) {
        const type = this.#worldMap.tiles[dest.x]?.[dest.y];
        return type !== null && type !== TILE_TYPES.wall;
    }

    /**
     * @param {(destination: TilePosition) => boolean} predicate
     * @return {boolean}
     */
    #hasNavigationPath(predicate) {
        if (this.#agentMovingActions.length > 0) {
            const destinationTile = this.#agentMovingActions.at(-1).to;
            console.log("Destination tile of current navigation path: ", destinationTile);
            return predicate(destinationTile);
        }

        return false;
    }

    async #hasParcel() {
        return this.#sensedParcels.some(parcel => parcel.carriedBy === this.#me.id);
    }

    /**
     * Returns the projected total reward of all parcels currently carried by this agent
     * after `steps` moves, accounting for value decay.
     *
     * Each move takes `CLOCK` ms. The parcel reward decreases by 1 every `decaying_event` ms.
     *
     * @param {number} [steps=0] - Number of move steps before delivery (0 = current value)
     * @returns {number}
     */
    #carriedParcelsValueAfterSteps(steps = 0) {
        const clock = this.#gameConfig.CLOCK ?? 0;
        const decayInterval = this.#gameConfig?.GAME?.parcels?.decaying_event ?? Infinity;

        return this.#sensedParcels
            .filter(parcel => parcel.carriedBy === this.#me.id)
            .reduce((total, parcel) => {
                const decay = decayInterval > 0 ? Math.floor((steps * clock) / decayInterval) : 0;
                return total + Math.max(0, parcel.reward - decay);
            }, 0);
    }

    /**
     * Projects the total reward when detouring to pick up a candidate parcel before delivering.
     *
     * All parcels (carried and candidate) decay continuously regardless of who holds them,
     * so the full trip length `stepsToParcel + stepsToDelivery` is used for every parcel.
     *
     * @param {number} stepsToParcel   - Steps from current position to the candidate parcel.
     * @param {number} stepsToDelivery - Steps from the candidate parcel to the delivery tile.
     * @param {IOParcel} candidateParcel - The parcel being considered for pickup.
     * @returns {number}
     */
    //FIXME currently the agent deviate to pick a parcel even though it doesn't worth it
    #carriedParcelsValueWithDeviation(stepsToParcel, stepsToDelivery, candidateParcel) {
        const totalSteps = stepsToParcel + stepsToDelivery;
        const clock = this.#gameConfig.CLOCK ?? 0;
        const decayInterval = this.#gameConfig?.GAME?.parcels?.decaying_event ?? Infinity;

        const carriedValue = this.#carriedParcelsValueAfterSteps(totalSteps);

        const candidateDecay = decayInterval > 0 ? Math.floor((totalSteps * clock) / decayInterval) : 0;
        const candidateValue = Math.max(0, candidateParcel.reward - candidateDecay);

        return carriedValue + candidateValue;
    }

    /**
     * Evaluates whether detouring to any free parcel improves total projected reward.
     * If a beneficial detour is found, loads the path to that parcel and returns true.
     * Returns false when going straight to delivery is already optimal.
     * @returns {Promise<boolean>}
     */
    async #greedyPickupParcel() {
        const pathToDelivery = await this.#getPathToClosestTargetTiles(this.#deliveryTiles);
        let bestReward = this.#carriedParcelsValueAfterSteps(pathToDelivery.distance);
        let bestPath = null;

        for (const parcel of this.#sensedParcels) {
            if (parcel.carriedBy != null) continue;

            const pathToParcel = await this.#pathFinder.aStar(this.#worldMap, { x: this.#me.x, y: this.#me.y }, { x: parcel.x, y: parcel.y }, this.#sensedAgents);
            if (!pathToParcel) continue;

            const pathFromParcelToDelivery = await this.#getPathToClosestTargetTiles(this.#deliveryTiles, { x: parcel.x, y: parcel.y });

            const deviationReward = this.#carriedParcelsValueWithDeviation(pathToParcel.distance, pathFromParcelToDelivery.distance, parcel);

            if (deviationReward > bestReward) {
                bestReward = deviationReward;
                bestPath = pathToParcel;
            }
        }

        if (bestPath) {
            console.log("Greedy deviation chosen — path to parcel:");
            console.dir(bestPath, { depth: null });
            this.#loadIntentionActions(bestPath);
            return true;
        }

        return false;
    }


    async #deliverParcel() {
        if(this.#isOnDeliveryTile()) {
            console.log(`Delivering parcel...`);
            await this.#socket.emitPutdown();

        } else if (this.#hasNavigationPath(dest => this.#destinationIsDeliveryTile(dest))) {
            const nextMove = this.#agentMovingActions.shift();
            const success = await this.#resilientMove(nextMove.direction);

            if (!success) {
                console.error(`Move failed, aborting current navigation path`);
                this.#agentMovingActions.length = 0; // clear remaining planned moves
            }

        } else {
            const navigationPath = await this.#getPathToClosestTargetTiles(this.#deliveryTiles);
            console.log("Navigation path planned:");
            console.dir(navigationPath, { depth: null });
            this.#loadIntentionActions(navigationPath);
        }
    }

    #detectsFreeParcelsNearby() {
        let freeParcels = false;
        this.#sensedParcels.forEach(parcel => {if (parcel.carriedBy == null) freeParcels = true;})
        // return this.#sensedParcels.length > 0;
        return freeParcels;
    }

    async #efficientPickupParcels() {

    }

    async #pickupClosestParcel() {
        if (this.#isOnParcelTile()) {
            await this.#socket.emitPickup()

            // If we are on a parcel tile that was not the destination of the current navigation path, we should clear the planned moves since we achieved our goal to pickup a parcel
            this.#agentMovingActions.length = 0;
        } else if (this.#hasNavigationPath(dest => this.#destinationIsParcelTile(dest))) {
            const nextMove = this.#agentMovingActions.shift();
            const success = await this.#resilientMove(nextMove.direction);

            if (!success) {
                console.error(`Move failed, aborting current navigation path`);
                this.#agentMovingActions.length = 0; // clear remaining planned moves
            }
        } else {
            const navigationPath = await this.#getPathToClosestTargetTiles(this.#sensedParcels.map(parcel => ({ x: parcel.x, y: parcel.y })));
            console.log("Navigation path to closest parcel planned:");
            console.dir(navigationPath, { depth: null });
            this.#loadIntentionActions(navigationPath);
        }
    }

    async #randomlyExploreMap() {
        if (this.#hasNavigationPath(dest => this.#destinationIsValidTile(dest))) {
            const nextMove = this.#agentMovingActions.shift();
            const success = await this.#resilientMove(nextMove.direction);

            if (!success) {
                console.error(`Move failed, aborting current navigation path`);
                this.#agentMovingActions.length = 0;
            }
        } else {
            // const validTiles = this.#parcelSpawnerTiles;
            // for (let x = 0; x < this.#worldMap.width; x++) {
            //     for (let y = 0; y < this.#worldMap.height; y++) {
            //         const type = this.#worldMap.tiles[x][y];
            //         if (type !== null && type !== TILE_TYPES.wall) {
            //             validTiles.push({ x, y });
            //         }
            //     }
            // }
            //
            // const randomTile = validTiles[Math.floor(Math.random() * validTiles.length)];a
            const randomSpawnerTile = this.#parcelSpawnerTiles[Math.floor(Math.random() * this.#parcelSpawnerTiles.length)];
            const navigationPath = await this.#pathFinder.aStar(this.#worldMap, { x: this.#me.x, y: this.#me.y }, randomSpawnerTile, this.#sensedAgents);
            console.log("Random exploration path planned:");
            console.dir(navigationPath, { depth: null });
            this.#loadIntentionActions(navigationPath);
        }
    }


    // ── Execution ─────────────────────────────────────────────────────────────

    /**
     * Starts the agent's deliberation and execution loops.
     *
     * - Execution loop: drains #agentMovingActions one step per server tick, retrying on failure.
     * - Deliberation: plans the next intention and loads its actions into the queue.
     *
     * @returns {Promise<void>}
     */
    async start() {
        console.log("Initializing...");
        await this.#initialize()
        console.log("Starting...");


        //TODO: write a resilientMove method that tries the move X times, if it fails the promise returns a failure

        const executionLoop = async () => {
            console.log("Execution Loop...");
            while (true) {
                if(await this.#hasParcel()) {
                    if (this.#isOnParcelTile()) {
                        await this.#socket.emitPickup();
                        this.#agentMovingActions.length = 0; // deviation goal reached, reset path
                    }

                    if (this.#hasNavigationPath(dest => this.#destinationIsParcelTile(dest))) {
                        // Mid-deviation: execute next step toward the greedy parcel
                        console.log("HERE SHOULD MOVE")
                        const nextMove = this.#agentMovingActions.shift();
                        const success = await this.#resilientMove(nextMove.direction);
                        if (!success) this.#agentMovingActions.length = 0;
                    } else {
                        // No deviation active: re-evaluate whether a detour is worthwhile
                        if (this.#detectsFreeParcelsNearby()) {
                            const deviating = await this.#greedyPickupParcel();
                            if (deviating) continue; // start executing the deviation next tick
                        }
                        console.log("I have a parcel, trying to deliver...");
                        await this.#deliverParcel();
                    }
                } else if(this.#detectsFreeParcelsNearby()) {
                    console.log("Parcels detected nearby, moving to pick up the closest...");

                    await this.#pickupClosestParcel();

                } else {
                    await this.#randomlyExploreMap();
                    await new Promise((r) => setTimeout(r, 0));
                }
            }
        };

        setTimeout(() => executionLoop(), START_DELAY_MS);
    }
}