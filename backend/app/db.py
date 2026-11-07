from __future__ import annotations

import math
import sqlite3
from typing import Any

from . import config
from .importer import ensure_database


def serialise_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: serialise_value(row[key]) for key in row.keys()}


def connect() -> sqlite3.Connection:
    ensure_database()
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
