"""「三年五倍」筛查 — 前复权 + 窗口内最高价口径。"""
from __future__ import annotations

import logging
import math
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from app.config import settings
from app.data_providers.normalizer import normalize_daily
from app.tickflow.client import get_client
from app.services.kline_sync import _datetime_to_ms

logger = logging.getLogger(__name__)

WINDOW_DAYS = 756
GAIN_THRESHOLD = 5.0
ANALYSIS_YEARS = 10  # 只统计该区间内的三年五倍窗口
BATCH_SIZE = 100
DATA_START = datetime(2013, 1, 1)
DATA_END = datetime.now().replace(hour=23, minute=59, second=59)

RESULT_FILENAME = "three_year_five_times.csv"
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "scripts" / "cache_daily_fwd"

_run_lock = threading.Lock()
_run_status: dict[str, Any] = {"running": False, "stage": "", "pct": 0, "message": ""}


def result_path() -> Path:
    p = Path(settings.data_dir) / "user_data" / RESULT_FILENAME
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_run_status() -> dict[str, Any]:
    return dict(_run_status)


def _set_status(stage: str, pct: int, message: str, *, running: bool | None = None) -> None:
    _run_status["stage"] = stage
    _run_status["pct"] = pct
    _run_status["message"] = message
    if running is not None:
        _run_status["running"] = running


def instruments_path() -> Path:
    return Path(settings.data_dir) / "instruments" / "instruments.parquet"


def get_all_symbols() -> list[str]:
    p = instruments_path()
    if p.exists():
        df = pl.read_parquet(p, columns=["symbol"])
        return sorted(df["symbol"].to_list())
    from app.data_providers.tickflow_provider import TickFlowProvider
    df = TickFlowProvider().get_instruments("stock")
    return sorted(df["symbol"].to_list())


def _fetch_forward_daily(chunk: list[str]) -> pl.DataFrame:
    """拉取前复权日 K（免费 API 支持 adjust=forward）。"""
    tf = get_client()
    raw = tf.klines.batch(
        chunk,
        period="1d",
        adjust="forward",
        start_time=_datetime_to_ms(DATA_START),
        end_time=_datetime_to_ms(DATA_END),
        count=10000,
        as_dataframe=True,
        show_progress=False,
    )
    frames: list[pl.DataFrame] = []
    if isinstance(raw, dict):
        for sym, sub in raw.items():
            normalized = normalize_daily(sub, default_symbol=sym, source="tickflow")
            if not normalized.is_empty():
                frames.append(normalized)
    else:
        normalized = normalize_daily(raw, source="tickflow")
        if not normalized.is_empty():
            frames.append(normalized)
    return pl.concat(frames, how="diagonal_relaxed") if frames else pl.DataFrame()


def get_name_map() -> dict[str, str]:
    p = instruments_path()
    if not p.exists():
        return {}
    df = pl.read_parquet(p, columns=["symbol", "name"])
    return dict(zip(df["symbol"].to_list(), df["name"].to_list(), strict=False))


def cached_symbols() -> set[str]:
    syms: set[str] = set()
    for f in CACHE_DIR.glob("*.parquet"):
        try:
            syms.update(pl.read_parquet(f, columns=["symbol"])["symbol"].unique().to_list())
        except Exception:
            continue
    return syms


def fetch_daily_chunks(symbols: list[str]) -> None:
    """分片拉取前复权日 K，写入 cache_daily_fwd。"""
    if not symbols:
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    chunks = [symbols[i : i + BATCH_SIZE] for i in range(0, len(symbols), BATCH_SIZE)]
    n_chunks = len(chunks)

    for idx, chunk in enumerate(chunks):
        cache_path = CACHE_DIR / f"{chunk[0]}_{chunk[-1]}.parquet"
        if cache_path.exists():
            pct = int((idx + 1) / n_chunks * 70)
            _set_status("fetch_daily", pct, f"日K缓存命中 {idx + 1}/{n_chunks}")
            continue
        for attempt in range(3):
            try:
                df = _fetch_forward_daily(chunk)
                time.sleep(1.5)
                break
            except Exception as e:
                logger.warning("daily fetch failed %s (attempt %d): %s", chunk[0], attempt + 1, e)
                time.sleep(5)
        else:
            logger.error("skip chunk %s…%s after 3 failures", chunk[0], chunk[-1])
            continue
        if not df.is_empty():
            df.write_parquet(cache_path)
        pct = int((idx + 1) / n_chunks * 70)
        _set_status("fetch_daily", pct, f"日K {idx + 1}/{n_chunks}")


def load_all_daily() -> pl.DataFrame:
    parts: list[pl.DataFrame] = []
    for f in sorted(CACHE_DIR.glob("*.parquet")):
        parts.append(pl.read_parquet(f))
    if not parts:
        return pl.DataFrame()
    return pl.concat(parts, how="diagonal_relaxed")


def analysis_period(years: int | None = ANALYSIS_YEARS) -> tuple[date | None, date]:
    """返回统计区间 [start, end]。years=None/0 表示不限起始日。"""
    end = date.today()
    if not years or years <= 0:
        return None, end
    return end - timedelta(days=years * 365), end


def _to_date(d: Any) -> date:
    if isinstance(d, date) and not isinstance(d, datetime):
        return d
    if isinstance(d, datetime):
        return d.date()
    return date.fromisoformat(str(d)[:10])


def find_3y5x(
    df: pl.DataFrame,
    name_map: dict[str, str] | None = None,
    *,
    years: int | None = ANALYSIS_YEARS,
) -> pl.DataFrame:
    """前复权口径：起始日收盘价 → 窗口内最高价的涨幅 ≥ 500%。

    仅在 analysis_period 区间内寻找最佳窗口（起始日、结束日均落在区间内）。
    """
    if df.is_empty():
        return pl.DataFrame()

    period_start, period_end = analysis_period(years)
    name_map = name_map or {}
    n_stocks = df["symbol"].n_unique()
    results: list[dict[str, Any]] = []

    for count, ((sym,), group) in enumerate(df.group_by("symbol", maintain_order=True), start=1):
        group = group.sort("date")
        closes = group["close"].to_numpy()
        highs = group["high"].to_numpy()
        dates = group["date"].to_numpy()
        n = len(closes)

        if n < WINDOW_DAYS:
            continue

        best_gain = 0.0
        best_start = best_end = best_peak_date = None
        best_sp = best_ep = 0.0

        for end_idx in range(WINDOW_DAYS - 1, n):
            start_idx = end_idx - WINDOW_DAYS + 1
            start_d = _to_date(dates[start_idx])
            end_d = _to_date(dates[end_idx])
            if period_start and start_d < period_start:
                continue
            if end_d > period_end:
                continue

            sp = closes[start_idx]
            if sp <= 0:
                continue
            window_highs = highs[start_idx : end_idx + 1]
            peak_idx = int(np.argmax(window_highs))
            ep = float(window_highs[peak_idx])
            gain = ep / sp
            if gain > best_gain:
                best_gain = gain
                best_start = dates[start_idx]
                best_end = dates[end_idx]
                best_peak_date = dates[start_idx + peak_idx]
                best_sp = float(sp)
                best_ep = ep

        if best_gain >= GAIN_THRESHOLD:
            results.append({
                "symbol": sym,
                "name": name_map.get(sym, ""),
                "start_date": str(best_start),
                "end_date": str(best_end),
                "peak_date": str(best_peak_date),
                "start_price": round(best_sp, 2),
                "peak_price": round(best_ep, 2),
                "gain_pct": round((best_gain - 1) * 100, 2),
                "gain_times": round(float(best_gain), 2),
            })

        if count % 500 == 0:
            pct = 60 + int(count / max(n_stocks, 1) * 35)
            _set_status("compute", pct, f"计算 {count}/{n_stocks}，已发现 {len(results)} 只")

    if not results:
        return pl.DataFrame()

    return (
        pl.DataFrame(results)
        .unique(subset=["symbol"], keep="first")
        .sort("gain_pct", descending=True)
    )


def run_full_scan(*, force_refetch_adj: bool = False) -> pl.DataFrame:
    """完整扫描：补拉缺失日K → 前复权 → 计算 → 写 CSV。"""
    with _run_lock:
        if _run_status["running"]:
            raise RuntimeError("扫描任务已在运行中")
        _run_status["running"] = True
        _set_status("init", 0, "初始化")

    try:
        return _run_full_scan_impl(force_refetch_adj=force_refetch_adj)
    except Exception as e:
        _set_status("error", 0, str(e))
        raise
    finally:
        _run_status["running"] = False


def _run_full_scan_impl(*, force_refetch_adj: bool = False) -> pl.DataFrame:
    symbols = get_all_symbols()
    if not symbols:
        raise RuntimeError("无法获取股票列表")

    if force_refetch_adj:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)

    to_fetch = sorted(set(symbols) - cached_symbols())
    _set_status("fetch_daily", 5, f"待拉取 {len(to_fetch)} 只前复权日K")
    fetch_daily_chunks(to_fetch)

    daily = load_all_daily()
    if daily.is_empty():
        raise RuntimeError("未获取到日K数据")

    name_map = get_name_map()
    _set_status("compute", 75, f"计算滚动窗口 ({daily['symbol'].n_unique()} 只)")
    results = find_3y5x(daily, name_map)

    out = result_path()
    if not results.is_empty():
        results.write_csv(out)
    else:
        out.write_text("symbol,name,start_date,end_date,peak_date,start_price,peak_price,gain_pct,gain_times\n")

    _set_status("done", 100, f"完成，共 {len(results)} 只")
    return results


def load_results(
    *,
    q: str | None = None,
    min_gain_pct: float | None = None,
    years: int | None = 10,
    sort_by: str = "gain_pct",
    sort_order: str = "desc",
    offset: int = 0,
    limit: int = 100,
) -> dict[str, Any]:
    """读取 CSV 并分页返回。"""
    path = result_path()
    if not path.exists():
        return {"total": 0, "rows": [], "generated_at": None, "meta": _meta(years)}

    df = pl.read_csv(path)
    if df.is_empty():
        return {"total": 0, "rows": [], "generated_at": _file_mtime(path), "meta": _meta(years)}

    if years and years > 0:
        period_start, period_end = analysis_period(years)
        df = df.with_columns(
            pl.col("start_date").str.to_date().alias("_start_d"),
            pl.col("end_date").str.to_date().alias("_end_d"),
        )
        df = df.filter(
            (pl.col("_start_d") >= period_start) & (pl.col("_end_d") <= period_end)
        ).drop("_start_d", "_end_d")

    if min_gain_pct is not None:
        df = df.filter(pl.col("gain_pct") >= min_gain_pct)

    if q:
        kw = q.strip()
        if kw:
            df = df.filter(
                pl.col("symbol").str.contains(kw, literal=False)
                | pl.col("name").str.contains(kw, literal=False)
            )

    desc = sort_order.lower() != "asc"
    if sort_by in df.columns:
        df = df.sort(sort_by, descending=desc, nulls_last=True)

    total = len(df)
    page = df.slice(offset, limit)

    rows = []
    for row in page.to_dicts():
        clean = {k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in row.items()}
        rows.append(clean)

    return {
        "total": total,
        "rows": rows,
        "generated_at": _file_mtime(path),
        "meta": _meta(years),
    }


def _meta(years: int | None = ANALYSIS_YEARS) -> dict[str, Any]:
    period_start, period_end = analysis_period(years)
    return {
        "window_days": WINDOW_DAYS,
        "gain_threshold": GAIN_THRESHOLD,
        "price_type": "forward_adjusted",
        "method": "起始日收盘价 → 756交易日内最高价",
        "data_start": DATA_START.date().isoformat(),
        "analysis_years": years,
        "analysis_start": period_start.isoformat() if period_start else None,
        "analysis_end": period_end.isoformat(),
    }


def get_symbol_kline(
    symbol: str,
    start_date: str,
    end_date: str,
    *,
    pad_days: int = 90,
) -> dict[str, Any]:
    """从本地前复权缓存读取 K 线，用于验证三年五倍窗口。"""
    daily = load_all_daily()
    if daily.is_empty():
        return {"symbol": symbol, "rows": [], "source": "cache_daily_fwd"}

    start = date.fromisoformat(start_date[:10])
    end = date.fromisoformat(end_date[:10])
    fetch_start = start - timedelta(days=pad_days)
    fetch_end = end + timedelta(days=pad_days)

    sub = (
        daily.filter(
            (pl.col("symbol") == symbol)
            & (pl.col("date") >= fetch_start)
            & (pl.col("date") <= fetch_end)
        )
        .sort("date")
        .select(["date", "open", "high", "low", "close", "volume"])
    )
    rows = []
    for row in sub.iter_rows(named=True):
        d = row["date"]
        rows.append({
            "date": d.isoformat() if hasattr(d, "isoformat") else str(d)[:10],
            "open": row["open"],
            "high": row["high"],
            "low": row["low"],
            "close": row["close"],
            "volume": row.get("volume"),
        })
    return {
        "symbol": symbol,
        "rows": rows,
        "source": "cache_daily_fwd",
        "price_type": "forward_adjusted",
        "range": {
            "fetch_start": fetch_start.isoformat(),
            "fetch_end": fetch_end.isoformat(),
            "window_start": start.isoformat(),
            "window_end": end.isoformat(),
        },
    }


def _file_mtime(path: Path) -> str | None:
    if not path.exists():
        return None
    return datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
