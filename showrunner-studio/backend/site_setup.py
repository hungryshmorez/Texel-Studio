"""Single-origin hosting: password gate + built frontend served by the backend.

The app spends Texel credits and stores media, so a public deployment must not be open.
Set APP_PASSWORD; browsers then show a login prompt (HTTP Basic, any username) and
same-origin fetches reuse it. TEXEL_REQUIRE_PASSWORD=1 refuses to start without one.
"""
import base64
import hmac
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
OPEN_PATHS = {"/api/health"}  # platform health checks


def install(app: FastAPI) -> None:
    password = os.environ.get("APP_PASSWORD", "")
    if not password and os.environ.get("TEXEL_REQUIRE_PASSWORD") == "1":
        raise RuntimeError("Set APP_PASSWORD before exposing Texel Studio publicly.")
    if password:
        @app.middleware("http")
        async def gate(request, call_next):
            if request.url.path in OPEN_PATHS:
                return await call_next(request)
            header = request.headers.get("authorization", "")
            supplied = ""
            if header.lower().startswith("basic "):
                try:
                    supplied = base64.b64decode(header[6:]).decode().partition(":")[2]
                except ValueError:
                    supplied = ""
            if hmac.compare_digest(supplied.encode(), password.encode()):
                return await call_next(request)
            return PlainTextResponse("Password required.", status_code=401, headers={"WWW-Authenticate": 'Basic realm="Texel Studio"'})
    if DIST.is_dir():
        # Registered last so every /api route keeps priority.
        app.mount("/", StaticFiles(directory=str(DIST), html=True), name="frontend")
