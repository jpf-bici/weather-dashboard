from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pymysql
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

app = FastAPI(title="Weather Dashboard")


def load_dotenv(path: Path) -> None:
    """Minimal .env loader (no external dependency)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


load_dotenv(APP_DIR / ".env")


def db_conn():
    host = os.environ.get("WEATHER_DB_HOST", "127.0.0.1")
    port = int(os.environ.get("WEATHER_DB_PORT", "3306"))
    user = os.environ.get("WEATHER_DB_USER")
    password = os.environ.get("WEATHER_DB_PASS")
    dbname = os.environ.get("WEATHER_DB_NAME", "weather")

    if not user or not password:
        raise RuntimeError(
            "Missing DB credentials (WEATHER_DB_USER / WEATHER_DB_PASS)."
        )

    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=dbname,
        autocommit=True,
        connect_timeout=5,
        read_timeout=5,
        write_timeout=5,
        cursorclass=pymysql.cursors.DictCursor,
        charset="utf8mb4",
    )


def dt_to_iso_z(dt: Any) -> str:
    """Convert a DATETIME (naive) or datetime to ISO Z string."""
    if dt is None:
        return ""
    if isinstance(dt, str):
        # If something returns as string, trust it's UTC-ish and normalize.
        return dt.replace(" ", "T") + "Z"
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    return str(dt)


@app.get("/api/timeseries")
def timeseries(days: int = Query(7, ge=1, le=31)) -> list[dict[str, Any]]:
    """
    Returns readings for the last N days (default 7), ordered ascending.
    """
    sql = """
        SELECT ts_utc, temp_f, humidity_pct, pressure_hpa
        FROM readings
        WHERE ts_utc >= UTC_TIMESTAMP() - INTERVAL %s DAY
        ORDER BY ts_utc ASC
    """
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (days,))
                rows = cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

    out = []
    for r in rows:
        out.append(
            {
                "ts_utc": dt_to_iso_z(r["ts_utc"]),
                "temp_f": float(r["temp_f"]),
                "humidity_pct": float(r["humidity_pct"]),
                "pressure_hpa": float(r["pressure_hpa"]),
            }
        )
    return out


@app.get("/api/summary")
def summary() -> dict[str, Any]:
    """
    Returns:
      - current values (latest row)
      - 24h temp high + timestamp
      - 24h temp low + timestamp
      - pressure change over 24h (hPa), using nearest sample to 24h ago
    """
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                # Latest reading
                cur.execute(
                    """
                    SELECT ts_utc, temp_f, humidity_pct, pressure_hpa
                    FROM readings
                    ORDER BY ts_utc DESC
                    LIMIT 1
                    """
                )
                current = cur.fetchone()
                if not current:
                    raise HTTPException(status_code=404, detail="No readings found")

                # 24h high temp
                cur.execute(
                    """
                    SELECT ts_utc, temp_f
                    FROM readings
                    WHERE ts_utc >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
                    ORDER BY temp_f DESC, ts_utc DESC
                    LIMIT 1
                    """
                )
                t_high = cur.fetchone()

                # 24h low temp
                cur.execute(
                    """
                    SELECT ts_utc, temp_f
                    FROM readings
                    WHERE ts_utc >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
                    ORDER BY temp_f ASC, ts_utc DESC
                    LIMIT 1
                    """
                )
                t_low = cur.fetchone()

                # Nearest sample to 24h ago (for pressure delta)
                cur.execute(
                    """
                    SELECT ts_utc, pressure_hpa
                    FROM readings
                    ORDER BY ABS(TIMESTAMPDIFF(SECOND, ts_utc, UTC_TIMESTAMP() - INTERVAL 24 HOUR))
                    LIMIT 1
                    """
                )
                p_24h = cur.fetchone()

        p_now = float(current["pressure_hpa"])
        p_then = float(p_24h["pressure_hpa"]) if p_24h else p_now
        delta = p_now - p_then

        return {
            "current": {
                "ts_utc": dt_to_iso_z(current["ts_utc"]),
                "temp_f": float(current["temp_f"]),
                "humidity_pct": float(current["humidity_pct"]),
                "pressure_hpa": p_now,
            },
            "temp_24h_high": {
                "ts_utc": dt_to_iso_z(t_high["ts_utc"]) if t_high else "",
                "temp_f": float(t_high["temp_f"]) if t_high else None,
            },
            "temp_24h_low": {
                "ts_utc": dt_to_iso_z(t_low["ts_utc"]) if t_low else "",
                "temp_f": float(t_low["temp_f"]) if t_low else None,
            },
            "pressure_24h_reference": {
                "ts_utc": dt_to_iso_z(p_24h["ts_utc"]) if p_24h else "",
                "pressure_hpa": float(p_then),
            },
            "pressure_change_hpa": round(delta, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


# Static dashboard
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/app.js")
def app_js():
    return FileResponse(str(STATIC_DIR / "app.js"))
