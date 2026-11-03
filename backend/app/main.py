import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import report, token

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

settings = get_settings()
app = FastAPI(title="Mario API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Access-Code"],
    max_age=600,
)

app.include_router(token.router)
app.include_router(report.router)


@app.get("/health")
async def health() -> dict[str, str]:
    # The frontend calls this on start-up to wake a sleeping free-tier instance.
    return {"status": "ok"}
