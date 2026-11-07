from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .errors import MissingArtifactError, UnknownAssetError
from .importer import ensure_database
from .models import HealthResponse
from .routes import routers

log = logging.getLogger("valmet.backend")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if ensure_database():
        log.info("imported workbook into %s", config.DB_PATH)
    yield


app = FastAPI(title="Valmet Industrial Metaverse API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(UnknownAssetError)
async def unknown_asset(_: Request, exc: UnknownAssetError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(MissingArtifactError)
async def missing_artifact(_: Request, exc: MissingArtifactError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.get("/api/health", tags=["health"], response_model=HealthResponse)
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "database": str(config.DB_PATH),
        "scene_objects": config.SCENE_OBJECTS.exists(),
        "nav": config.NAV.exists(),
        "nav_targets": config.NAV_TARGETS.exists(),
    }


for router in routers:
    app.include_router(router)
