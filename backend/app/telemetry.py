from __future__ import annotations

import sqlite3
from typing import Any

import pandas as pd

METRICS: dict[str, dict[str, str]] = {
    "vibration_mm_s": {"label": "Vibration", "unit": "mm/s"},
    "process_flow_pct": {"label": "Process flow", "unit": "%"},
    "process_pressure_bar": {"label": "Process pressure", "unit": "bar"},
    "bearing_temp_c": {"label": "Bearing temperature", "unit": "degC"},
    "motor_current_a": {"label": "Motor current", "unit": "A"},
    "speed_rpm": {"label": "Speed", "unit": "rpm"},
    "position_setpoint_pct": {"label": "Position setpoint", "unit": "%"},
    "position_actual_pct": {"label": "Position actual", "unit": "%"},
    "pneumatic_supply_bar": {"label": "Pneumatic supply", "unit": "bar"},
    "stiction_index": {"label": "Stiction index", "unit": ""},
    "load_for_opening_pct": {"label": "Load for opening", "unit": "%"},
    "signal_quality_pct": {"label": "Signal quality", "unit": "%"},
    "sensor_bias": {"label": "Sensor bias", "unit": ""},
}

HEALTHY_STATES = {"healthy", "normal", "ok"}
HEALTHY_SCORE = 80


def _r(value: float) -> float:
    return round(float(value), 2)


def load_asset_telemetry(conn: sqlite3.Connection, asset_id: str) -> pd.DataFrame:
    return pd.read_sql_query(
        "SELECT * FROM Telemetry_Sample_3d WHERE asset_id = ? ORDER BY timestamp",
        conn,
        params=(asset_id,),
        parse_dates=["timestamp"],
    )


def available_metrics(df: pd.DataFrame) -> list[str]:
    return [m for m in METRICS if m in df and df[m].notna().any()]


def first_last_day(df: pd.DataFrame, metric: str) -> dict[str, Any] | None:
    """Daily mean on the first and last day of the window, as used for the trend evidence."""
    series = df[["timestamp", metric]].dropna()
    if series.empty:
        return None
    dates = series["timestamp"].dt.date
    first_date, last_date = dates.min(), dates.max()
    first = _r(series.loc[dates == first_date, metric].mean())
    last = _r(series.loc[dates == last_date, metric].mean())
    delta = _r(last - first)
    return {
        "metric": metric,
        "unit": METRICS[metric]["unit"],
        "first_day": first_date.isoformat(),
        "last_day": last_date.isoformat(),
        "first_day_mean": first,
        "last_day_mean": last,
        "delta": delta,
        "delta_pct": round(100.0 * delta / first, 1) if first else None,
        "min": _r(series[metric].min()),
        "max": _r(series[metric].max()),
        "samples": int(len(series)),
    }


def healthy_peers(conn: sqlite3.Connection, asset_class: str, exclude: str) -> list[str]:
    rows = conn.execute(
        "SELECT asset_id, condition_state, health_score FROM Current_State WHERE asset_class = ? AND asset_id != ?",
        (asset_class, exclude),
    ).fetchall()
    peers = []
    for asset_id, state, score in rows:
        try:
            healthy_score = score is not None and float(score) >= HEALTHY_SCORE
        except (TypeError, ValueError):
            healthy_score = False
        if str(state).lower() in HEALTHY_STATES or healthy_score:
            peers.append(asset_id)
    return sorted(peers)


def class_baseline(conn: sqlite3.Connection, asset_class: str, exclude: str, metrics: list[str]) -> dict[str, dict[str, Any]]:
    """Healthy-class band per metric: mean and 10th-90th percentile over all healthy peer samples."""
    peers = healthy_peers(conn, asset_class, exclude)
    if not peers or not metrics:
        return {}
    placeholders = ",".join("?" for _ in peers)
    df = pd.read_sql_query(
        f"SELECT asset_id, {', '.join(metrics)} FROM Telemetry_Sample_3d WHERE asset_id IN ({placeholders})",
        conn,
        params=peers,
    )
    result = {}
    for metric in metrics:
        values = pd.to_numeric(df[metric], errors="coerce").dropna()
        if values.empty:
            continue
        result[metric] = {
            "metric": metric,
            "unit": METRICS[metric]["unit"],
            "asset_class": asset_class,
            "peer_asset_ids": peers,
            "mean": _r(values.mean()),
            "p10": _r(values.quantile(0.1)),
            "p90": _r(values.quantile(0.9)),
            "samples": int(len(values)),
        }
    return result
