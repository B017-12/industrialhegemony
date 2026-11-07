"""Excel builder pack -> in-memory store (+ JSON snapshot for the web app).

The store is the single source of truth for asset data: the backend imports `PackStore`,
the pipeline's map stage reads it, and `snapshot()` writes what the frontend needs when the
API is not running. Telemetry can be appended at runtime (`append_telemetry`).

Nothing here is invented: every value comes from the workbook. Files the pack references
but that were not provided (telemetry_full_14d_30min.csv, DOC-ASSET-*.md) are reported as
missing rather than synthesised.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from pipeline.common import DERIVED, WEB_ASSETS, XLSX_PATH, write_json

SHEETS = [
    "START_HERE", "Public_Research", "Asset_Master", "Scene_Anchors", "Current_State",
    "Telemetry_Sample_3d", "Alarms_Events", "Maintenance_History", "Historical_Service_Cases",
    "Knowledge_Docs", "RAG_Corpus_Index", "Data_Quality", "Builder_Questions", "API_Contract",
    "Dashboard", "Change_Log",
]
TABULAR = [s for s in SHEETS if s not in ("START_HERE", "Dashboard")]
DATE_COLUMNS = {
    "Asset_Master": ["installation_date", "last_service_date"],
    "Current_State": ["last_updated"],
    "Telemetry_Sample_3d": ["timestamp"],
    "Alarms_Events": ["timestamp"],
    "Maintenance_History": ["opened_at"],
}
MISSING_FILES = ["telemetry_full_14d_30min.csv"] + [f"DOC-ASSET-{i:03d}.md" for i in range(1, 31)]


@dataclass
class PackStore:
    tables: dict[str, pd.DataFrame]
    source: str
    _appended: int = field(default=0)

    # ---- construction -------------------------------------------------------------------
    @classmethod
    def load(cls, path: Path = XLSX_PATH) -> "PackStore":
        frames = pd.read_excel(path, sheet_name=TABULAR, engine="openpyxl")
        for name, cols in DATE_COLUMNS.items():
            for col in cols:
                frames[name][col] = pd.to_datetime(frames[name][col])
        frames["Telemetry_Sample_3d"] = frames["Telemetry_Sample_3d"].sort_values(["asset_id", "timestamp"])
        return cls(tables=frames, source=str(Path(path).resolve()))

    # ---- lookups ------------------------------------------------------------------------
    def asset_ids(self) -> list[str]:
        return self.tables["Asset_Master"]["asset_id"].tolist()

    def asset(self, asset_id: str) -> dict:
        """Asset_Master + Current_State + Scene_Anchors row for one asset."""
        master = self._row("Asset_Master", asset_id)
        state = self._row("Current_State", asset_id)
        anchor = self._row("Scene_Anchors", asset_id)
        return {"master": master, "state": state, "anchor": anchor}

    def telemetry(self, asset_id: str, last_n: int | None = None) -> pd.DataFrame:
        t = self.tables["Telemetry_Sample_3d"]
        rows = t[t["asset_id"] == asset_id].dropna(axis=1, how="all")
        return rows.tail(last_n) if last_n else rows

    def events(self, asset_id: str) -> pd.DataFrame:
        e = self.tables["Alarms_Events"]
        return e[e["asset_id"] == asset_id].sort_values("timestamp", ascending=False)

    def work_orders(self, asset_id: str) -> pd.DataFrame:
        w = self.tables["Maintenance_History"]
        return w[w["asset_id"] == asset_id].sort_values("opened_at", ascending=False)

    def data_quality(self, asset_id: str) -> pd.DataFrame:
        d = self.tables["Data_Quality"]
        return d[d["asset_id"] == asset_id]

    def cases(self, asset_class: str, issue_code: str | None = None) -> pd.DataFrame:
        c = self.tables["Historical_Service_Cases"]
        c = c[c["asset_class"] == asset_class]
        return c[c["historical_issue_code"] == issue_code] if issue_code else c

    def documents(self, asset_id: str | None = None, asset_class: str | None = None) -> list[dict]:
        """Knowledge docs that exist in the pack for this asset: its class core doc + the ALL-scope docs."""
        docs = self.tables["Knowledge_Docs"]
        scopes = {"ALL"} | ({asset_class} if asset_class else set())
        if asset_id and not asset_class:
            scopes.add(self._row("Asset_Master", asset_id)["asset_class"])
        return _records(docs[docs["scope"].isin(scopes)])

    def evidence_ids(self) -> set[str]:
        """Every citable ID in the pack (used to validate AI citations)."""
        t = self.tables
        ids: set[str] = set(t["Asset_Master"]["asset_id"]) | set(t["Asset_Master"]["tag"])
        ids |= set(t["Alarms_Events"]["event_id"]) | set(t["Maintenance_History"]["work_order_id"])
        ids |= set(t["Historical_Service_Cases"]["case_id"]) | set(t["Knowledge_Docs"]["doc_id"])
        ids |= set(t["Data_Quality"]["issue_id"]) | set(t["Scene_Anchors"]["scene_anchor_id"])
        return ids

    # ---- mutation -----------------------------------------------------------------------
    def append_telemetry(self, asset_id: str, values: dict) -> dict:
        """Append one telemetry row (unknown columns rejected); returns the stored row."""
        t = self.tables["Telemetry_Sample_3d"]
        if asset_id not in set(t["asset_id"]):
            raise KeyError(asset_id)
        unknown = set(values) - set(t.columns)
        if unknown:
            raise ValueError(f"unknown telemetry columns: {sorted(unknown)}")
        last = t[t["asset_id"] == asset_id].iloc[-1]
        row = last.copy()
        row[[c for c in t.columns if c not in ("timestamp", "asset_id", "tag", "asset_class", "area_id")]] = None
        row["timestamp"] = pd.Timestamp(values.get("timestamp", last["timestamp"] + pd.Timedelta(minutes=30)))
        row["source_profile"] = "runtime_append"
        row["synthetic_record"] = True
        for k, v in values.items():
            if k != "timestamp":
                row[k] = v
        self.tables["Telemetry_Sample_3d"] = pd.concat([t, row.to_frame().T], ignore_index=True)
        self._appended += 1
        return _records(row.to_frame().T)[0]

    # ---- export -------------------------------------------------------------------------
    def asset_cards(self) -> list[dict]:
        """One merged record per asset — what the frontend inspector needs."""
        cards = []
        for asset_id in self.asset_ids():
            a = self.asset(asset_id)
            m, s, an = a["master"], a["state"], a["anchor"]
            cards.append({
                "asset_id": asset_id,
                "tag": m["tag"],
                "asset_class": m["asset_class"],
                "area_name": m["area_name"],
                "process_context": m["process_context"],
                "criticality": m["criticality"],
                "connectivity_profile": m["connectivity_profile"],
                "qr_id": m["qr_id"],
                "nfc_id": m["nfc_id"],
                "installation_date": m["installation_date"],
                "last_service_date": m["last_service_date"],
                "service_interval_days": m["service_interval_days"],
                "health_score": s["health_score"],
                "condition_state": s["condition_state"],
                "issue_code": s["issue_code"],
                "issue_summary": s["issue_summary"],
                "urgency": s["urgency"],
                "recommended_next_check": s["recommended_next_check"],
                "model_confidence": s["model_confidence"],
                "knowledge_doc_id": s["knowledge_doc_id"],
                "placeholder_anchor": {
                    "scene_anchor_id": an["scene_anchor_id"],
                    "mapping_status": an["mapping_status"],
                    "mapping_confidence": an["mapping_confidence"],
                },
                "counts": {
                    "events": int(len(self.events(asset_id))),
                    "work_orders": int(len(self.work_orders(asset_id))),
                    "data_quality_issues": int(len(self.data_quality(asset_id))),
                },
            })
        return cards

    def snapshot(self, out_dir: Path = DERIVED / "pack") -> dict:
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, df in self.tables.items():
            write_json(out_dir / f"{name}.json", _records(df))
        cards = self.asset_cards()
        write_json(WEB_ASSETS / "pack_assets.json", cards)
        summary = {
            "source": self.source,
            "rows": {name: int(len(df)) for name, df in self.tables.items()},
            "assets": len(cards),
            "health_below_70": sorted(c["tag"] for c in cards if c["health_score"] < 70),
            "missing_referenced_files": MISSING_FILES,
        }
        write_json(out_dir / "summary.json", summary)
        return summary

    def _row(self, sheet: str, asset_id: str) -> dict:
        df = self.tables[sheet]
        rows = df[df["asset_id"] == asset_id]
        if rows.empty:
            raise KeyError(f"{asset_id} not in {sheet}")
        return _records(rows)[0]


def _records(df: pd.DataFrame) -> list[dict]:
    out = df.astype(object).where(df.notna(), None)
    recs = out.to_dict(orient="records")
    for r in recs:
        for k, v in r.items():
            if isinstance(v, pd.Timestamp):
                r[k] = v.isoformat()
    return recs


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args()
    store = PackStore.load()
    summary = store.snapshot()
    print(f"excel: {summary['assets']} assets, rows={summary['rows']}")
    print(f"  health<70: {summary['health_below_70']}")
    print(f"  missing referenced files: telemetry_full_14d_30min.csv + {len(MISSING_FILES) - 1} DOC-ASSET cards")


if __name__ == "__main__":
    main()
