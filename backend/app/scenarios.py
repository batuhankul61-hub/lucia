"""Practice scenarios. Each one becomes the system instruction of a Live session.

The prompt text lives in `frontend/prompts.json`, shared with the browser's
bring-your-own-key mode so the two can't drift apart. In server mode the
ephemeral token locks the prompt, so a client can't turn the tutor into a
general-purpose voice bot.
"""

import json
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

PROMPTS_FILE = Path(__file__).resolve().parents[2] / "frontend" / "prompts.json"
PROMPTS = json.loads(PROMPTS_FILE.read_text(encoding="utf-8"))


class Level(str, Enum):
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    role: str
    goal: str


SCENARIOS: dict[str, Scenario] = {
    s["id"]: Scenario(id=s["id"], title=s["title"], role=s["role"], goal=s["goal"]) for s in PROMPTS["scenarios"]
}

REPORT_INSTRUCTION = "\n".join(PROMPTS["reportInstruction"])


def build_system_instruction(scenario: Scenario, level: Level) -> str:
    return "\n".join(PROMPTS["liveInstruction"]).format(
        role=scenario.role, goal=scenario.goal, level=level.value, levelGuide=PROMPTS["levels"][level.value]
    )
