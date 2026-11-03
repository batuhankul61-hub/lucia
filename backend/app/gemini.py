"""The only module that talks to Gemini. Routers depend on `GeminiService`,
so tests can swap in a fake without touching the network."""

import datetime as dt

from google import genai
from google.genai import types

from .config import Settings
from .report_schema import Report, ReportUsage, Turn
from .scenarios import Level, Scenario, build_system_instruction

REPORT_INSTRUCTION = """You are an English teacher reviewing a learner's spoken practice conversation.
The transcript comes from speech recognition, so ignore capitalisation, missing punctuation and filler words.
Only judge lines spoken by the LEARNER.
Rules:
- Every "original" field must be copied word for word from a single LEARNER line. Never paraphrase it.
- Only list real mistakes. If a sentence is correct, don't mention it.
- If the learner said very little, return short lists and say so in the summary.
- fluency_score: how smoothly and fully they expressed ideas. accuracy_score: grammar and word choice.
- Vocabulary: up to 5 useful words or phrases that came up in the conversation or in your corrections."""


class GeminiService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key)

    async def create_live_token(self, scenario: Scenario, level: Level, minutes: int) -> types.AuthToken:
        now = dt.datetime.now(tz=dt.timezone.utc)
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=build_system_instruction(scenario, level),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
        )
        return await self._client.aio.auth_tokens.create(
            config=types.CreateAuthTokenConfig(
                uses=1,
                expire_time=now + dt.timedelta(minutes=minutes),
                new_session_expire_time=now + dt.timedelta(minutes=1),
                live_connect_constraints=types.LiveConnectConstraints(model=self.settings.live_model, config=config),
                # Empty list = lock exactly the fields set above (model, prompt,
                # modalities, transcription); the client may still pass a
                # session-resumption handle.
                lock_additional_fields=[],
            )
        )

    async def generate_report(self, scenario: Scenario, level: Level, turns: list[Turn]) -> tuple[str, ReportUsage]:
        transcript = "\n".join(f"{'LEARNER' if t.role == 'user' else 'TUTOR'}: {t.text}" for t in turns)
        response = await self._client.aio.models.generate_content(
            model=self.settings.report_model,
            contents=f"Scenario: {scenario.title}. Learner level: {level.value}.\n\nTranscript:\n{transcript}",
            config=types.GenerateContentConfig(
                system_instruction=REPORT_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=Report,
                temperature=0.2,
            ),
        )
        meta = response.usage_metadata
        usage = ReportUsage(
            model=self.settings.report_model,
            prompt_tokens=(meta.prompt_token_count or 0) if meta else 0,
            output_tokens=(meta.candidates_token_count or 0) if meta else 0,
        )
        return response.text or "", usage
