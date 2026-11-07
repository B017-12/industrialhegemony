from __future__ import annotations

import argparse
import sqlite3

import pandas as pd

from . import config


def import_workbook() -> list[str]:
    """Load every workbook sheet into SQLite (one table per sheet, replaced)."""
    if not config.WORKBOOK.exists():
        raise RuntimeError(f"Workbook not found: {config.WORKBOOK}")
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheets = pd.read_excel(config.WORKBOOK, sheet_name=None)
    with sqlite3.connect(config.DB_PATH) as conn:
        for name, df in sheets.items():
            cleaned = df.copy()
            for column in cleaned.columns:
                if pd.api.types.is_datetime64_any_dtype(cleaned[column]):
                    cleaned[column] = cleaned[column].dt.strftime("%Y-%m-%dT%H:%M:%S")
            cleaned = cleaned.where(pd.notnull(cleaned), None)
            cleaned.to_sql(name, conn, if_exists="replace", index=False)
    return list(sheets)


def database_is_stale() -> bool:
    if not config.DB_PATH.exists():
        return True
    if config.WORKBOOK.exists() and config.WORKBOOK.stat().st_mtime > config.DB_PATH.stat().st_mtime:
        return True
    return False


def ensure_database(force: bool = False) -> bool:
    """Import the workbook when forced, missing or older than the workbook. Returns True if it imported."""
    if force or database_is_stale():
        import_workbook()
        return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the Valmet workbook into SQLite.")
    parser.add_argument("--force", action="store_true", help="re-import even if the database is up to date")
    args = parser.parse_args()
    imported = ensure_database(force=args.force)
    print(f"{'imported' if imported else 'up to date'}: {config.DB_PATH}")


if __name__ == "__main__":
    main()
