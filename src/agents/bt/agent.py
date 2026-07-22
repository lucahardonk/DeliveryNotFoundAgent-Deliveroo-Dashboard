"""Behaviour-Tree (BT) agent.

A minimal reactive agent. Every tick it re-evaluates a fixed priority tree:

    deliver  >  pick up parcel here  >  go to nearest free parcel  >  explore

The loop is deliberately simple - each behaviour is a coroutine returning
``True`` when it "handled" the tick (so we stop and start over), or ``False`` to
fall through to the next behaviour. This mirrors the sense -> decide -> act
structure of the original JavaScript behaviour tree, kept minimal.
"""

from __future__ import annotations

import asyncio
import random

from ..base import BaseAgent

TICK_DELAY = 0.3  # seconds between ticks


class BTAgent(BaseAgent):
    agent_type = "bt"

    async def run(self) -> None:
        # A behaviour tree is just an ordered list of behaviours (a Selector):
        # the first one that "handles" the tick wins.
        behaviours = [
            self._deliver,
            self._pickup_here,
            self._go_to_parcel,
            self._explore,
        ]
        while True:
            # ── SENSE ── beliefs are updated in the background by the client.
            # ── DECIDE + ACT ── run the tree until a behaviour handles the tick.
            for behaviour in behaviours:
                if await behaviour():
                    break
            await self.report_state()
            await asyncio.sleep(TICK_DELAY)

    # ── behaviours (leaf nodes) ──────────────────────────────────────────────
    async def _deliver(self) -> bool:
        """If carrying parcels, head to (and drop at) the nearest delivery tile."""
        if not self.carrying:
            return False
        if self.on_delivery_tile():
            self.current_action = "putdown"
            await self.client.putdown()
            return True
        target = self.nearest(self.delivery_tiles)
        direction = self.step_towards(target) if target else None
        if direction:
            self.current_action = f"deliver: move {direction}"
            await self.client.move(direction)
            return True
        return False

    async def _pickup_here(self) -> bool:
        """If standing on a free parcel, pick it up."""
        if self.parcel_at_me():
            self.current_action = "pickup"
            await self.client.pickup()
            return True
        return False

    async def _go_to_parcel(self) -> bool:
        """Move one step toward the nearest free parcel, if any."""
        target = self.nearest(self.free_parcels())
        direction = self.step_towards(target) if target else None
        if direction:
            self.current_action = f"seek parcel: move {direction}"
            await self.client.move(direction)
            return True
        return False

    async def _explore(self) -> bool:
        """Fallback: wander in a random direction."""
        direction = random.choice(["up", "down", "left", "right"])
        self.current_action = f"explore: move {direction}"
        await self.client.move(direction)
        return True
