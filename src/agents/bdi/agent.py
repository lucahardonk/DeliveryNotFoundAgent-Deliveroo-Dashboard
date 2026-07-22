"""Belief-Desire-Intention (BDI) agent.

A minimal BDI deliberation loop:

* **Beliefs**  - the world model kept fresh in :class:`BaseAgent`
  (my position, sensed parcels, delivery tiles ...).
* **Desires**  - the goals the agent could pursue right now, each with a score.
* **Intention**- the single goal it commits to, turned into a concrete plan
  (a target tile) that it then executes one step at a time.

Compared to the reactive BT agent, the BDI agent *commits* to an intention and
only reconsiders it when the plan is complete or beliefs make it invalid.
"""

from __future__ import annotations

import asyncio
import random
from typing import Optional

from ..base import BaseAgent

TICK_DELAY = 0.3  # seconds between deliberation ticks


class BDIAgent(BaseAgent):
    agent_type = "bdi"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # The current intention: {"goal": str, "target": {x, y}}.
        self.intention: Optional[dict] = None

    async def run(self) -> None:
        while True:
            # 1. SENSE  - beliefs updated in the background by the client.
            # 2. DELIBERATE - generate desires and pick the best intention.
            desires = self._generate_desires()
            best = self._select_intention(desires)

            # 3. Reconsider: switch intention only when the goal changed.
            if best and (self.intention is None or best["goal"] != self.intention["goal"]):
                self.intention = best

            # 4. ACT - execute one step of the committed intention's plan.
            await self._execute_intention()

            await self.report_state(extra={"intention": self.intention["goal"] if self.intention else None})
            await asyncio.sleep(TICK_DELAY)

    # ── desires ──────────────────────────────────────────────────────────────
    def _generate_desires(self) -> list[dict]:
        """Produce the candidate goals with a priority score (higher = better)."""
        desires: list[dict] = []

        # Deliver what we carry (highest priority when carrying something).
        if self.carrying:
            target = self.nearest(self.delivery_tiles)
            if target:
                desires.append({"goal": "deliver", "target": target, "score": 100})

        # Pick up the nearest free parcel.
        parcel = self.nearest(self.free_parcels())
        if parcel:
            mx, my = self.me.get("x", 0), self.me.get("y", 0)
            dist = abs(parcel["x"] - mx) + abs(parcel["y"] - my)
            desires.append({"goal": "pickup", "target": parcel, "score": 50 - dist})

        # Explore when there is nothing better to do.
        desires.append({"goal": "explore", "target": None, "score": 1})
        return desires

    def _select_intention(self, desires: list[dict]) -> Optional[dict]:
        return max(desires, key=lambda d: d["score"]) if desires else None

    # ── intention execution (plans) ──────────────────────────────────────────
    async def _execute_intention(self) -> None:
        if not self.intention:
            return
        goal = self.intention["goal"]

        if goal == "deliver":
            if self.on_delivery_tile():
                self.current_action = "putdown"
                await self.client.putdown()
                self.intention = None  # intention achieved
                return
            await self._move_towards(self.intention["target"], f"{goal}")

        elif goal == "pickup":
            target = self.intention["target"]
            if self.me.get("x") == target["x"] and self.me.get("y") == target["y"]:
                self.current_action = "pickup"
                await self.client.pickup()
                self.intention = None  # intention achieved
                return
            await self._move_towards(target, f"{goal}")

        else:  # explore
            direction = random.choice(["up", "down", "left", "right"])
            self.current_action = f"explore: move {direction}"
            await self.client.move(direction)

    async def _move_towards(self, target: dict, label: str) -> None:
        direction = self.step_towards(target)
        if direction:
            self.current_action = f"{label}: move {direction}"
            await self.client.move(direction)
        else:
            # Cannot make progress - drop the intention so we reconsider.
            self.intention = None
