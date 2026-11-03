"""The only module that talks to Gemini. Routers depend on `GeminiService`,
so tests can swap in a fake without touching the network."""

import datetime as dt
import logging

from google import genai
from google.genai import errors, types

from .config import Settings
from .report_schema import Report, ReportUsage, Turn
from .scenarios import REPORT_INSTRUCTION, Level, Scenario, build_system_instruction

log = logging.getLogger(__name__)

RETRYABLE = {429, 500, 503}


class GeminiService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key)

    async def create_live_token(self, scenario: Scenario, level: Level, minutes: int) -> types.AuthToken:
        now = dt.datetime.now(tz=dt.timezone.utc)
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=build_system_instruction(scenario, level),
            # VERBATIM keeps the learner's mistakes ("I goed"); the default
            # mode quietly fixes them, which would hide them from the report.
            input_audio_transcription=types.AudioTranscriptionConfig(mode=types.AudioTranscriptionConfigMode.VERBATIM),
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
        # Same layout as reportPrompt() in frontend/js/byok.js.
        transcript = "\n".join(f"{'LEARNER' if t.role == 'user' else 'TUTOR'}: {t.text}" for t in turns)
        contents = f"Scenario: {scenario.title}. Learner level: {level.value}.\n\nTranscript:\n{transcript}"
        config = types.GenerateContentConfig(
            system_instruction=REPORT_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=Report,
            temperature=0.2,
        )

        # Flash-Lite models sometimes return 503 "high demand"; fall back to
        # the next model instead of failing the learner's report.
        models = self.settings.report_models
        for i, model in enumerate(models):
            try:
                response = await self._client.aio.models.generate_content(model=model, contents=contents, config=config)
                break
            except errors.APIError as exc:
                if exc.code not in RETRYABLE or i == len(models) - 1:
                    raise
                log.warning("Report model %s returned %s, trying %s", model, exc.code, models[i + 1])

        meta = response.usage_metadata
        usage = ReportUsage(
            model=model,
            prompt_tokens=(meta.prompt_token_count or 0) if meta else 0,
            output_tokens=(meta.candidates_token_count or 0) if meta else 0,
        )
        return response.text or "", usage
