"""「三年五倍」筛查 API。"""
from __future__ import annotations

import threading

from fastapi import APIRouter, HTTPException, Query

from app.services import stock_growth

router = APIRouter(prefix="/api/stock-growth", tags=["stock-growth"])


@router.get("")
def list_results(
    q: str | None = Query(None, description="代码或名称关键词"),
    min_gain_pct: float | None = Query(None, ge=0),
    years: int | None = Query(10, ge=0, le=30, description="0=不限时间"),
    sort_by: str = Query("gain_pct"),
    sort_order: str = Query("desc"),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
) -> dict:
    return stock_growth.load_results(
        q=q,
        min_gain_pct=min_gain_pct,
        years=years if years else None,
        sort_by=sort_by,
        sort_order=sort_order,
        offset=offset,
        limit=limit,
    )


@router.get("/status")
def scan_status() -> dict:
    status = stock_growth.get_run_status()
    path = stock_growth.result_path()
    return {
        **status,
        "has_results": path.exists() and path.stat().st_size > 80,
        "result_path": str(path),
    }


@router.get("/kline")
def get_kline(
    symbol: str = Query(..., description="标的代码"),
    start_date: str = Query(..., description="窗口起始日 YYYY-MM-DD"),
    end_date: str = Query(..., description="窗口结束日 YYYY-MM-DD"),
    peak_date: str | None = Query(None, description="峰值日 YYYY-MM-DD"),
) -> dict:
    data = stock_growth.get_symbol_kline(symbol, start_date, end_date)
    if peak_date:
        data["peak_date"] = peak_date[:10]
    if not data["rows"]:
        raise HTTPException(404, f"未找到 {symbol} 的缓存 K 线数据")
    return data


@router.post("/refresh")
def refresh_scan(force_adj: bool = Query(False)) -> dict:
    if stock_growth.get_run_status().get("running"):
        raise HTTPException(409, "扫描任务正在运行中")

    def _run() -> None:
        try:
            stock_growth.run_full_scan(force_refetch_adj=force_adj)
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "message": "扫描任务已启动，请稍后刷新页面"}
