# DeliveryNotFoundAgent — Deliveroo Dashboard

Autonomous Software Agents @ UniTN 2025-26.

Minimal, modular JavaScript project: three interchangeable agent strategies for
the [Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js) game, plus a
**standalone live dashboard** that the agents talk to only over a small REST API.

## Project layout

```
.
├── main.js                     # launcher: reads .env, spawns ONE agent per token
├── .env.example                # configuration template
├── dashboard/                  # ── standalone module (no agent code) ──
│   ├── server.js               #   REST API + serves the UI (Express)
│   ├── package.json            #   its own dependencies / start script
│   └── public/index.html       #   vanilla HTML+JS, polls the REST API
├── src/
│   └── agents/
│       ├── bdi/                 # BDI strategy + the shared foundation
│       │   ├── AgentCore.js      #   connection, beliefs, capabilities, reporting
│       │   ├── DeliverooClient.js  # thin SDK wrapper
│       │   ├── grid.js          #   map model + BFS pathfinding
│       │   └── BdiAgent.js      #   Belief–Desire–Intention strategy
│       ├── bt/BtAgent.js        # Behaviour-Tree strategy   (imports core from ../bdi)
│       └── base_agent/BaseGreedyAgent.js  # greedy baseline (imports core from ../bdi)
├── test/smoke.test.js          # runs without a live server (mock client)
├── documentation/              # (kept from the original project)
└── examples/                   # (kept from the original project)
```

## Architecture

- **Agents and dashboard are decoupled.** The dashboard knows nothing about the
  SDK or the strategies — agents just `POST` their latest snapshot to it, and the
  browser polls it back out. You can run the dashboard on another port/host, or
  not at all; agents keep working either way (reporting is fire-and-forget).
- **Only active agents are shown.** Agents report a few times per second. The
  dashboard treats an agent as active only while it keeps reporting: if it goes
  silent for `AGENT_TTL_MS` (default 5s) it is dropped. So the dashboard always
  shows **exactly as many agents as there are active tokens** — leftovers from a
  previous run (e.g. you ran 2 tokens, now run 1) disappear on their own.
- **One process, many agents.** `main.js` spawns one agent per token; each runs
  its **own independent loop** (`AgentCore.run()` is overridden per strategy).
- **Shared capabilities, distinct brains.** `AgentCore` (in `src/agents/bdi/`,
  reused by all three strategies) provides the world model (map, self, parcels,
  other agents) and low-level actions (BFS `stepToward`, `pickup`, `putdown`,
  `reportState`). Each strategy only implements *how it decides*:
  - `base` — greedy priority: deliver → pick up here → go to nearest parcel → explore.
  - `bt`   — the same priorities expressed as a small behaviour tree (selector/sequence).
  - `bdi`  — scored desires → commit to the best intention → execute until done/invalid.

## Setup

```bash
npm install
cp .env.example .env    # then edit HOST + your token(s)
```

## Run

Start the dashboard (separate module), then the agents:

```bash
npm run dashboard       # http://localhost:3001
npm start               # spawns agents from .env
```

## Configuration (`.env`)

```ini
HOST="http://localhost:8080/"
DASHBOARD_URL="http://localhost:3001"

# Strategy: bt | bdi | base  (default bt)
AGENT_TYPE=bt

# Tokens — spawn ONE agent per token, in ANY of these formats:
TOKEN=your_token                     # single
# TOKENS=aaa, bbb, ccc               # comma-separated
# TOKEN_1=aaa                        # numbered
# TOKEN_2=bbb
```

Per-agent strategy overrides (optional): `AGENT_TYPES=bt,bdi,base` or
`AGENT_TYPE_1=bt`, aligned with the token order.

## Test

```bash
npm test    # mock-client smoke tests: grid/BFS, beliefs, all 3 strategies, dashboard REST
```
