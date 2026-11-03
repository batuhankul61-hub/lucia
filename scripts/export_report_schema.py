"""Writes frontend/report-schema.json from the backend's `Report` model.

Usage (from the repo root): backend/.venv/Scripts/python scripts/export_report_schema.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.report_schema import gemini_response_schema  # noqa: E402

OUT = ROOT / "frontend" / "report-schema.json"

if __name__ == "__main__":
    OUT.write_text(json.dumps(gemini_response_schema(), indent=2) + "\n", encoding="utf-8")
    print("Wrote", OUT)
