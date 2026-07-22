"""Shared building blocks for every agent.

This module contains two things that are common to both the Behaviour-Tree (BT)
and the Belief-Desire-Intention (BDI) agents:

* :class:`DeliverooClient` - a thin async wrapper around the Deliveroo game
  server. The Deliveroo server speaks Socket.IO (Engine.IO v4) which rides on
  top of plain HTTP long-polling, so this client is implemented with ``aiohttp``
  alone (no extra SDK). It exposes the small, stable surface the agents need:
  ``connect`` / ``move`` / ``pickup`` / ``putdown`` / ``shout`` plus a queue of
  incoming events (``map``, ``you``, ``parcels sensing`` ...).

* :class:`BaseAgent` - holds the token, host, agent_id and dashboard_url, keeps
  a minimal world model updated from the server events, and knows how to
  ``report_state`` (POST a snapshot to the dashboard).

The concrete strategies (``bt/agent.py`` and ``bdi/agent.py``) subclass
:class:`BaseAgent` and implement their own deliberation ``run`` loop.
"""

from __future__ import annotations

import asyncio
import json
import urllib.parse
from typing import Any, Awaitable, Callable, Optional

import aiohttp


# Directions understood by the Deliveroo server.
OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}


class DeliverooClient:
    """Minimal async Socket.IO (Engine.IO v4) client for the Deliveroo server.

    Only the polling transport is implemented - it is the simplest reliable
    transport and is enough for an agent. The client keeps a background task
    that long-polls the server and dispatches decoded events to registered
    handlers.
    """

    def __init__(self, token: str, host: str) -> None:
        # Normalise host so it ends with a single trailing slash.
        self.host = (host or "http://localhost:8080/").rstrip("/") + "/"
        self.token = token
        self._session: Optional[aiohttp.ClientSession] = None
        self._sid: Optional[str] = None
        self._ack_id = 0
        self._acks: dict[int, asyncio.Future] = {}
        self._handlers: dict[str, list[Callable[[Any], None]]] = {}
        self._poll_task: Optional[asyncio.Task] = None
        self._connected = False

    # ── connection lifecycle ────────────────────────────────────────────────
    @property
    def connected(self) -> bool:
        return self._connected

    def _url(self, extra: str = "") -> str:
        query = {"EIO": "4", "transport": "polling", "token": self.token}
        if self._sid:
            query["sid"] = self._sid
        return f"{self.host}socket.io/?{urllib.parse.urlencode(query)}{extra}"

    async def connect(self) -> None:
        """Perform the Engine.IO handshake + Socket.IO namespace connect."""
        self._session = aiohttp.ClientSession()

        # 1) Engine.IO open handshake.
        async with self._session.get(self._url()) as resp:
            raw = await resp.text()
        packet = raw.split("\x1e", 1)[0]
        if not packet.startswith("0"):
            raise RuntimeError(f"Unexpected handshake packet: {packet!r}")
        info = json.loads(packet[1:])
        self._sid = info["sid"]

        # 2) Socket.IO CONNECT to the default namespace ("40").
        await self._post("40")

        # 3) Read the CONNECT ack (also default namespace).
        async with self._session.get(self._url()) as resp:
            raw = await resp.text()
        for pkt in raw.split("\x1e"):
            self._handle_packet(pkt)

        self._connected = True
        self._poll_task = asyncio.create_task(self._poll_loop())

    async def close(self) -> None:
        self._connected = False
        if self._poll_task:
            self._poll_task.cancel()
        if self._session:
            await self._session.close()

    # ── event handling ───────────────────────────────────────────────────────
    def on(self, event: str, handler: Callable[[Any], None]) -> None:
        """Register a handler for a Socket.IO event (e.g. ``map``, ``you``)."""
        self._handlers.setdefault(event, []).append(handler)

    def _emit_local(self, event: str, *args: Any) -> None:
        for handler in self._handlers.get(event, []):
            payload = args[0] if len(args) == 1 else args
            handler(payload)

    async def _poll_loop(self) -> None:
        """Continuously long-poll the server and dispatch incoming packets."""
        try:
            while self._connected and self._session:
                async with self._session.get(self._url()) as resp:
                    raw = await resp.text()
                for pkt in raw.split("\x1e"):
                    self._handle_packet(pkt)
        except asyncio.CancelledError:
            pass
        except Exception:
            # Connection dropped - mark disconnected so the agent can react.
            self._connected = False

    def _handle_packet(self, pkt: str) -> None:
        if not pkt:
            return
        eio_type = pkt[0]
        body = pkt[1:]
        if eio_type == "2":  # Engine.IO ping -> reply pong.
            asyncio.create_task(self._post("3"))
            return
        if eio_type != "4":  # only Engine.IO "message" packets carry data.
            return
        # Socket.IO layer.
        sio_type = body[0] if body else ""
        rest = body[1:]
        if sio_type == "2":  # EVENT
            self._dispatch_event(rest)
        elif sio_type == "3":  # ACK
            self._dispatch_ack(rest)

    def _dispatch_event(self, rest: str) -> None:
        # rest looks like: [ackId]["event", data...]
        idx = rest.find("[")
        if idx == -1:
            return
        try:
            data = json.loads(rest[idx:])
        except json.JSONDecodeError:
            return
        if not data:
            return
        event, args = data[0], data[1:]
        self._emit_local(event, *args)

    def _dispatch_ack(self, rest: str) -> None:
        # rest looks like: <ackId>[response]
        i = 0
        while i < len(rest) and rest[i].isdigit():
            i += 1
        try:
            ack_id = int(rest[:i])
        except ValueError:
            return
        try:
            args = json.loads(rest[i:])
        except json.JSONDecodeError:
            args = []
        fut = self._acks.pop(ack_id, None)
        if fut and not fut.done():
            fut.set_result(args[0] if args else None)

    # ── low-level transport ──────────────────────────────────────────────────
    async def _post(self, data: str) -> None:
        assert self._session is not None
        async with self._session.post(self._url(), data=data) as resp:
            await resp.read()

    async def _emit(self, event: str, *args: Any, want_ack: bool = True) -> Any:
        """Emit a Socket.IO event, optionally awaiting the server ack."""
        payload = [event, *args]
        if want_ack:
            self._ack_id += 1
            ack_id = self._ack_id
            fut: asyncio.Future = asyncio.get_event_loop().create_future()
            self._acks[ack_id] = fut
            await self._post(f"42{ack_id}{json.dumps(payload)}")
            try:
                return await asyncio.wait_for(fut, timeout=5)
            except asyncio.TimeoutError:
                self._acks.pop(ack_id, None)
                return None
        await self._post(f"42{json.dumps(payload)}")
        return None

    # ── actions ──────────────────────────────────────────────────────────────
    async def move(self, direction: str) -> Any:
        return await self._emit("move", direction)

    async def pickup(self) -> Any:
        return await self._emit("pickup")

    async def putdown(self) -> Any:
        return await self._emit("putdown")

    async def shout(self, message: str) -> Any:
        return await self._emit("shout", message)


class BaseAgent:
    """Common state + dashboard reporting shared by BT and BDI agents.

    Subclasses implement :meth:`run` (their deliberation loop). This base wires
    up the Deliveroo client, keeps a small world model fresh from the server
    events, and reports snapshots to the dashboard.
    """

    #: Overridden by subclasses ("bt" / "bdi"); shown on the dashboard.
    agent_type = "base"

    def __init__(
        self,
        token: str,
        host: str,
        agent_id: str,
        dashboard_url: str = "http://localhost:8001",
    ) -> None:
        self.token = token
        self.host = host
        self.agent_id = agent_id
        self.dashboard_url = dashboard_url.rstrip("/")
        self.client = DeliverooClient(token=token, host=host)

        # ── minimal world model (beliefs) ────────────────────────────────────
        self.me: dict[str, Any] = {}          # {id, name, x, y, score}
        self.map: dict[str, Any] = {}         # {width, height, tiles}
        self.delivery_tiles: list[dict] = []  # tiles where parcels are scored
        self.parcels: list[dict] = []         # currently sensed parcels
        self.agents: list[dict] = []          # currently sensed other agents
        self.config: dict[str, Any] = {}

        self.status = "starting"
        self.current_action = "idle"
        self._report_session: Optional[aiohttp.ClientSession] = None

    # ── connection + belief wiring ───────────────────────────────────────────
    async def connect(self) -> None:
        """Connect to Deliveroo and register belief-updating event handlers."""
        self.client.on("map", self._on_map)
        self.client.on("you", self._on_you)
        self.client.on("parcels sensing", self._on_parcels)
        self.client.on("agents sensing", self._on_agents)
        self.client.on("config", self._on_config)
        await self.client.connect()

    def _on_map(self, payload: Any) -> None:
        # Server emits: map(width, height, tiles)
        if isinstance(payload, (list, tuple)) and len(payload) >= 3:
            width, height, tiles = payload[0], payload[1], payload[2]
        else:
            return
        self.map = {"width": width, "height": height, "tiles": tiles}
        self.delivery_tiles = [t for t in tiles if t.get("delivery") or t.get("type") == 2]

    def _on_you(self, payload: Any) -> None:
        if isinstance(payload, dict):
            payload = dict(payload)
            payload["x"] = round(payload.get("x", 0))
            payload["y"] = round(payload.get("y", 0))
            self.me = payload

    def _on_parcels(self, payload: Any) -> None:
        if isinstance(payload, list):
            self.parcels = payload

    def _on_agents(self, payload: Any) -> None:
        if isinstance(payload, list):
            self.agents = payload

    def _on_config(self, payload: Any) -> None:
        if isinstance(payload, dict):
            self.config = payload

    # ── helpers used by both strategies ──────────────────────────────────────
    @property
    def carrying(self) -> list[dict]:
        """Parcels currently carried by me."""
        my_id = self.me.get("id")
        return [p for p in self.parcels if p.get("carriedBy") == my_id]

    def free_parcels(self) -> list[dict]:
        """Sensed parcels that nobody is carrying."""
        return [p for p in self.parcels if not p.get("carriedBy")]

    def parcel_at_me(self) -> bool:
        return any(
            not p.get("carriedBy") and p.get("x") == self.me.get("x") and p.get("y") == self.me.get("y")
            for p in self.parcels
        )

    def on_delivery_tile(self) -> bool:
        return any(
            t.get("x") == self.me.get("x") and t.get("y") == self.me.get("y")
            for t in self.delivery_tiles
        )

    def step_towards(self, target: dict) -> Optional[str]:
        """Greedy one-step direction from ``me`` toward ``target`` (x/y dict)."""
        if not self.me or target is None:
            return None
        dx = target.get("x", self.me["x"]) - self.me["x"]
        dy = target.get("y", self.me["y"]) - self.me["y"]
        if abs(dx) >= abs(dy) and dx != 0:
            return "right" if dx > 0 else "left"
        if dy != 0:
            return "up" if dy > 0 else "down"
        if dx != 0:
            return "right" if dx > 0 else "left"
        return None

    def nearest(self, items: list[dict]) -> Optional[dict]:
        """Nearest item (by Manhattan distance) to my current position."""
        if not items or not self.me:
            return None
        mx, my = self.me["x"], self.me["y"]
        return min(items, key=lambda i: abs(i.get("x", mx) - mx) + abs(i.get("y", my) - my))

    # ── dashboard reporting ──────────────────────────────────────────────────
    async def report_state(self, extra: Optional[dict] = None) -> None:
        """POST a snapshot of this agent's state to the dashboard.

        Fire-and-forget: dashboard connectivity problems never crash the agent.
        """
        if self._report_session is None:
            self._report_session = aiohttp.ClientSession()
        state = {
            "agent_id": self.agent_id,
            "agent_type": self.agent_type,
            "status": self.status,
            "current_action": self.current_action,
            "name": self.me.get("name"),
            "x": self.me.get("x"),
            "y": self.me.get("y"),
            "score": self.me.get("score"),
            "carrying": len(self.carrying),
            "sensed_parcels": len(self.parcels),
        }
        if extra:
            state.update(extra)
        url = f"{self.dashboard_url}/api/agents/{self.agent_id}/state"
        try:
            async with self._report_session.post(url, json=state) as resp:
                await resp.read()
        except Exception:
            # Dashboard may not be up yet - ignore so the agent keeps running.
            pass

    async def run(self) -> None:  # pragma: no cover - implemented by subclasses
        raise NotImplementedError

    async def start(self) -> None:
        """Connect (with retry) then run the deliberation loop forever."""
        while True:
            try:
                self.status = "connecting"
                await self.report_state()
                await self.connect()
                # Give the server a moment to push the initial beliefs.
                await asyncio.sleep(1)
                self.status = "running"
                await self.run()
            except Exception as exc:  # keep the agent alive across drop-outs
                self.status = f"error: {exc}"
                self.current_action = "reconnecting"
                await self.report_state()
                await asyncio.sleep(3)
