"""Request/response models for the post-conversation report.

The same `Report` model is given to Gemini as the response schema and is used
to validate what comes back. `ground_report` then drops anything that doesn't
quote what the learner actually said, so the report can't invent mistakes.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field

from .scenarios import Level


class Turn(BaseModel):
    role: Literal["user", "tutor"]
    text: str = Field(max_length=4000)


class ReportRequest(BaseModel):
    scenario_id: str
    level: Level = Level.B1
    turns: list[Turn] = Field(min_length=1, max_length=400)


class GrammarMistake(BaseModel):
    original: str = Field(description="The learner's words, copied exactly from the transcript.")
    corrected: str = Field(description="The corrected version.")
    explanation: str = Field(description="One short sentence explaining the rule.")


class NaturalPhrasing(BaseModel):
    original: str = Field(description="The learner's words, copied exactly from the transcript.")
    suggestion: str = Field(description="A more natural way a native speaker would say it.")


class VocabularyItem(BaseModel):
    word: str
    meaning: str = Field(description="Short, simple English definition.")
    example: str = Field(description="An example sentence that fits this conversation.")


class Report(BaseModel):
    grammar_mistakes: list[GrammarMistake] = Field(max_length=15)
    natural_phrasing: list[NaturalPhrasing] = Field(max_length=10)
    vocabulary: list[VocabularyItem] = Field(max_length=10)
    fluency_score: int = Field(ge=0, le=100)
    accuracy_score: int = Field(ge=0, le=100)
    summary: str = Field(description="Two or three encouraging sentences of overall feedback.")


class ReportUsage(BaseModel):
    model: str
    prompt_tokens: int = 0
    output_tokens: int = 0


class ReportResponse(BaseModel):
    report: Report
    usage: ReportUsage
    # How many items the model returned that weren't backed by the transcript.
    dropped_ungrounded: int = 0


def gemini_response_schema() -> dict:
    """`Report` as the Gemini API's response schema, the way the SDK sends it.

    Written to frontend/report-schema.json by scripts/export_report_schema.py
    for bring-your-own-key mode; a test keeps the file in sync with `Report`.
    Uses the SDK's (private) transformer so both modes send the same schema.
    """
    from google.genai import Client, _transformers

    schema = _transformers.t_schema(Client(api_key="unused")._api_client, Report)
    return schema.model_dump(mode="json", exclude_none=True, by_alias=True)


# Python's \w includes Unicode letters; transcript.js uses the same rule.
_NON_WORD = re.compile(r"[^\w']+")


def normalize(text: str) -> str:
    """Lowercase and strip punctuation, so 'I goed, there.' matches 'i goed there'."""
    return " ".join(_NON_WORD.sub(" ", text.lower()).split())


def ground_report(report: Report, turns: list[Turn]) -> tuple[Report, int]:
    """Keep only items whose quoted 'original' appears in the learner's turns."""
    user_text = " | ".join(normalize(t.text) for t in turns if t.role == "user")
    all_text = " | ".join(normalize(t.text) for t in turns)

    def said(quote: str) -> bool:
        q = normalize(quote)
        return bool(q) and q in user_text

    grammar = [m for m in report.grammar_mistakes if said(m.original)]
    phrasing = [p for p in report.natural_phrasing if said(p.original)]

    # A vocabulary word must come from the conversation or from our own corrections.
    suggestions = " | ".join(normalize(x) for x in [*(m.corrected for m in grammar), *(p.suggestion for p in phrasing)])
    vocab = [
        v for v in report.vocabulary if normalize(v.word) and (normalize(v.word) in all_text or normalize(v.word) in suggestions)
    ]

    dropped = (
        len(report.grammar_mistakes) - len(grammar)
        + len(report.natural_phrasing) - len(phrasing)
        + len(report.vocabulary) - len(vocab)
    )
    grounded = report.model_copy(update={"grammar_mistakes": grammar, "natural_phrasing": phrasing, "vocabulary": vocab})
    return grounded, dropped
