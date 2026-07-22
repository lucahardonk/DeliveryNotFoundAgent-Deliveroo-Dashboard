# DeliveryNotFound — Deliveroo Agent + Dashboard

Autonomous Software Agents project (@unitn 2025-26). A minimal Python
implementation of a Deliveroo delivery agent, available in two flavours —
**Behaviour Tree (BT)** and **Belief-Desire-Intention (BDI)** — plus a small live
dashboard.

## Project layout

```
project/
├── dashboard/
│   ├── server.py          # FastAPI REST API (agents POST state, UI polls it)
│   ├── static/
│   │   └── index.html     # Plain HTML+JS dashboard, polls /api/agents
│   └── requirements.txt
├── src/
│   └── agents/
│       ├── base.py        # DeliverooClient (socket.io over aiohttp) + BaseAgent
│       ├── bt/agent.py    # BT agent (behaviour-tree style loop)
│       └── bdi/agent.py   # BDI agent (belief-desire-intention loop)
├── main.py                # Entry point: parse .env, spawn one agent per token
├── .env.example           # Template .env
├── requirements.txt       # Top-level deps
├── documentation/         # design notes (kept as-is)
└── examples/              # example scripts (kept as-is)
```

## Setup

```bash
pip install -r requirements.txt          # agent deps
pip install -r dashboard/requirements.txt # dashboard deps
cp .env.example .env                       # then edit your token(s)
```

## Run

Start the dashboard (terminal 1):

```bash
uvicorn dashboard.server:app --port 8001
```

Open <http://localhost:8001> to watch the agents.

Start the agents (terminal 2):

```bash
python main.py
```

## Configuration (`.env`)

| Variable        | Default                  | Description                              |
| --------------- | ------------------------ | ---------------------------------------- |
| `HOST`          | `http://localhost:8080/` | Deliveroo server URL                     |
| `AGENT_TYPE`    | `bt`                     | Strategy for every agent: `bt` or `bdi`  |
| `DASHBOARD_URL` | `http://localhost:8001`  | Where agents POST their state            |

**Tokens** — one agent is spawned per token. Use any of the three formats:

```bash
# 1) Single agent:
TOKEN=your_token

# 2) Many agents, comma-separated:
TOKENS=token_aaa, token_bbb, token_ccc

# 3) Many agents, numbered:
TOKEN_1=token_aaa
TOKEN_2=token_bbb
```

## How it works

* **`DeliverooClient`** wraps the Deliveroo server's Socket.IO (Engine.IO v4)
  protocol using only `aiohttp` long-polling. It exposes
  `move` / `pickup` / `putdown` / `shout` and streams `map` / `you` /
  `parcels sensing` / `agents sensing` events into the agent's beliefs.
* **`BaseAgent`** holds the shared world model and a `report_state()` method that
  POSTs a snapshot to the dashboard.
* **BT agent** re-evaluates a fixed priority tree each tick:
  `deliver > pickup-here > go-to-parcel > explore`.
* **BDI agent** generates scored desires, commits to the best as an intention,
  and executes it one step at a time until achieved.
* **Dashboard** keeps the latest state per agent in memory; the page polls
  `GET /api/agents` every 2 seconds and renders a live table.
