DeliveryNotFoundAgent — Deliveroo Dashboard
Autonomous Software Agents @ UniTN 2025-26.
Minimal, modular JavaScript project: three interchangeable agent strategies for
the Deliveroo.js game, plus a
standalone live dashboard that agents report to over a small REST + SSE API.
Project layout
```
.
├── main.js                          # launcher: reads config.json, spawns one agent per entry
├── config.json                      # all configuration (host, dashboard URL, agents + tokens)
├── dashboard/
│   ├── server.js                    # REST API + SSE broadcast + serves the UI (Express)
│   ├── package.json
│   └── public/index.html            # vanilla HTML+JS, real-time via SSE
├── src/
│   └── agents/
│       ├── base_agent/              # greedy baseline (fully standalone)
│       │   ├── GreedyAgent.js       #   agent class: setup() + loop() + decision logic
│       │   ├── astar.js             #   A* pathfinding (walkableFn + blocked set)
│       │   ├── WorldModel.js        #   single source of truth: map, self, parcels, others
│       │   ├── ServerIO.js          #   thin SDK wrapper: move / pickup / putdown hooks
│       │   └── Dashboard.js         #   fire-and-forget POST to dashboard REST API
│       ├── bdi/BdiAgent.js          # Belief–Desire–Intention strategy
│       └── bt/BtAgent.js            # Behaviour-Tree strategy
├── test/smoke.test.js
├── documentation/
└── examples/
```
Architecture
Agents and dashboard are fully decoupled. The dashboard knows nothing about
the SDK or the strategies — agents `POST` snapshots to it, and the browser
receives them instantly via SSE (`/api/stream`). You can run the dashboard
on another port/host, or not at all; agents keep working either way (reporting
is fire-and-forget).
Real-time UI. The browser holds one persistent SSE connection. Every agent
POST triggers an immediate server push — no polling, no lag.
Only active agents are shown. If an agent goes silent for `AGENT_TTL_MS`
(default 5 s) it is dropped automatically. Leftovers from a previous run
disappear on their own.
One process, many agents. `main.js` reads `config.json` and spawns one
agent per entry; each runs its own independent `loop()`.
Agents are standalone classes. No inheritance — every agent implements
`setup(token)` and `loop()` independently. `main.js` calls `agent.loop()`
directly to guarantee correct `this` binding.
Modular internals (`base_agent`). Logic is split across five focused files:
`astar.js` (pathfinding), `WorldModel.js` (state), `ServerIO.js` (SDK calls),
`Dashboard.js` (reporting), `GreedyAgent.js` (strategy).
Setup
```bash
npm install
```
Edit `config.json` with your host, dashboard URL, and agent tokens:
```json
{
  "host": "http://localhost:8080/",
  "dashboardUrl": "http://localhost:3001",
  "tickMs": 200,
  "agents": [
    {
      "name": "Greedy_One",
      "type": "base_agent",
      "token": "YOUR_TOKEN_HERE"
    }
  ]
}
```
Run
```bash
npm run dashboard   # start dashboard → http://localhost:3001
npm start           # spawn agents from config.json
```
Agent strategies
key	description
`base_agent`	Greedy: deliver → pick up here → go to nearest parcel → explore
`bt`	Same priorities expressed as a behaviour tree (selector/sequence)
`bdi`	Scored desires → commit to best intention → execute until done/invalid
Test
```bash
npm test    # mock-client smoke tests: A*, WorldModel, all 3 strategies, dashboard REST
```