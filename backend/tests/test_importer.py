from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import config, importer

EXPECTED_SHEETS = 16


def test_imports_all_sheets_into_fresh_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    db = tmp_path / "valmet.db"
    monkeypatch.setattr(config, "DB_PATH", db)

    sheets = importer.import_workbook()

    assert len(sheets) == EXPECTED_SHEETS
    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert set(sheets) <= tables
    assert {"Asset_Master", "Current_State", "Alarms_Events", "Telemetry_Sample_3d", "Data_Quality"} <= tables
    assert importer.ensure_database() is False


def test_live_db_has_all_sheets() -> None:
    with sqlite3.connect(config.DB_PATH) as conn:
        count = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]
    assert count == EXPECTED_SHEETS
