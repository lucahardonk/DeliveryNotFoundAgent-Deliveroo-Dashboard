"""FastAPI dashboard server.

A tiny REST server that agents (possibly running in other processes) push their
state to, and that a plain HTML+JS page polls to render a live view.

Endpoints
---------
* ``POST /api/agents/{agent_id}/state`` - an agent reports its current state.
* ``GET  /api/agents``                  - list every known agent's state.
* ``GET  /``                            - serve the dashboard page.

Run with::

    uvicorn dashboard.server:app --port 8001
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="DeliveryNotFound Dashboard")

STATIC_DIR = Path(__file__).parent / "static"

# In-memory store: agent_id -> latest state dict (with a server timestamp).
_agents: Dict[str, Dict[str, Any]] = {}


@app.post("/api/agents/{agent_id}/state")
async def report_state(agent_id: str, request: Request) -> JSONResponse:
    """Store the latest state an agent reports about itself."""
    try:
        state = await request.json()
    except Exception:
        state = {}
    state["agent_id"] = agent_id
    state["last_update"] = time.time()
    _agents[agent_id] = state
    return JSONResponse({"ok": True})


@app.get("/api/agents")
async def list_agents() -> JSONResponse:
    """Return the list of all known agent states (newest field included)."""
    return JSONResponse({"agents": list(_agents.values()), "now": time.time()})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
