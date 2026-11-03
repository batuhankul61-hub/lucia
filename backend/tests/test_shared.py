"""The browser's bring-your-own-key mode reuses files from frontend/; keep them in sync."""

import json

from app.report_schema import gemini_response_schema
from app.scenarios import PROMPTS, PROMPTS_FILE, SCENARIOS, Level, build_system_instruction

SCHEMA_FILE = PROMPTS_FILE.parent / "report-schema.json"


def test_report_schema_file_matches_model():
    committed = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    assert committed == gemini_response_schema(), "Run scripts/export_report_schema.py"


def test_every_scenario_has_display_and_prompt_fields():
    for s in PROMPTS["scenarios"]:
        assert {"id", "title", "blurb", "icon", "role", "goal"} <= s.keys()


def test_every_level_has_a_guide():
    assert set(PROMPTS["levels"]) == {level.value for level in Level}


def test_system_instruction_fills_every_placeholder():
    text = build_system_instruction(SCENARIOS["business-meeting"], Level.C1)
    assert "{" not in text
    assert "project status meeting" in text
    assert PROMPTS["levels"]["C1"] in text
