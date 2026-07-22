"""Entry point: read ``.env``, spawn one agent per token, run them concurrently.

Each token becomes its own agent (BT or BDI, chosen via ``AGENT_TYPE``) running
in its own asyncio task. All agents share the process and report their live
state to the dashboard.

Start the dashboard separately, e.g.::

    uvicorn dashboard.server:app --port 8001

Then run the agents::

    python main.py
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import List

from dotenv import load_dotenv

from src.agents.bt import BTAgent
from src.agents.bdi import BDIAgent

AGENT_CLASSES = {"bt": BTAgent, "bdi": BDIAgent}


def _split_list(value: str | None) -> List[str]:
    """Split a comma/whitespace separated list into clean, non-empty items."""
    if not value:
        return []
    return [item.strip() for item in re.split(r"[,\s]+", value) if item.strip()]


def collect_tokens() -> List[str]:
    """Collect tokens from any of the three supported .env formats.

    Precedence: ``TOKENS`` (list) > ``TOKEN_1``, ``TOKEN_2`` ... > ``TOKEN``.
    """
    # 2) TOKENS=a,b,c
    from_list = _split_list(os.getenv("TOKENS"))
    if from_list:
        return from_list

    # 3) TOKEN_1, TOKEN_2, ... (contiguous from 1)
    numbered: List[str] = []
    i = 1
    while os.getenv(f"TOKEN_{i}"):
        numbered.append(os.getenv(f"TOKEN_{i}", "").strip())
        i += 1
    if numbered:
        return numbered

    # 1) single TOKEN
    single = os.getenv("TOKEN")
    if single and single.strip():
        return [single.strip()]

    return []


async def main() -> None:
    load_dotenv()

    host = os.getenv("HOST", "http://localhost:8080/")
    dashboard_url = os.getenv("DASHBOARD_URL", "http://localhost:8001")
    agent_type = os.getenv("AGENT_TYPE", "bt").strip().lower()
    if agent_type not in AGENT_CLASSES:
        print(f"⚠️  Unknown AGENT_TYPE={agent_type!r}; falling back to 'bt'.")
        agent_type = "bt"

    tokens = collect_tokens()
    if not tokens:
        print(
            "\n❌ No token found. Add TOKEN, TOKENS or TOKEN_1.. to your .env file.\n"
            "   Example:\n"
            '     HOST="http://localhost:8080/"\n'
            "     TOKENS=token_aaa, token_bbb\n"
        )
        return

    agent_cls = AGENT_CLASSES[agent_type]
    print(f"\n🎮 Spawning {len(tokens)} {agent_type.upper()} agent(s) from .env")
    print(f"📊 Dashboard: {dashboard_url}\n")

    tasks = []
    for i, token in enumerate(tokens, start=1):
        agent_id = f"{agent_type}-{i}"
        preview = f"{token[:8]}…" if len(token) > 8 else token
        print(f"🤖 Agent {agent_id}: token={preview}")
        agent = agent_cls(
            token=token,
            host=host,
            agent_id=agent_id,
            dashboard_url=dashboard_url,
        )
        tasks.append(asyncio.create_task(agent.start()))

    print("\n🛑 Press Ctrl+C to stop all agents.\n")
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Shutting down all agents…")
