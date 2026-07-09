"""找出过去10年所有有过「三年五倍」的A股 (前复权 + 窗口内最高价 ≥500%)。

用法: uv run python scripts/find_3y5x.py
输出: data/user_data/three_year_five_times.csv
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import stock_growth


def main() -> None:
    print("=" * 60)
    print("   「三年五倍」A股筛查 (前复权 + 窗口最高价)")
    print(f"   窗口: {stock_growth.WINDOW_DAYS} 交易日, 阈值: {stock_growth.GAIN_THRESHOLD}x")
    print(f"   范围: {stock_growth.DATA_START.date()} ~ {stock_growth.DATA_END.date()}")
    print("=" * 60)

    results = stock_growth.run_full_scan()
    out = stock_growth.result_path()

    if results.is_empty():
        print("\n未找到满足条件的股票")
        return

    print(f"\n✅ 共 {len(results)} 只股票")
    print(f"📁 已保存: {out}\n")

    n_print = min(30, len(results))
    print(f"{'#':>4} | {'代码':<10} | {'名称':<8} | {'起始':<12} | {'峰值日':<12} | {'起始价':>8} | {'最高价':>8} | {'涨幅%':>8}")
    print("-" * 95)
    for i, row in enumerate(results.head(n_print).to_dicts()):
        print(
            f"{i+1:>4} | {row['symbol']:<10} | {(row.get('name') or ''):<8} | "
            f"{row['start_date']:<12} | {row['peak_date']:<12} | "
            f"{row['start_price']:>8.2f} | {row['peak_price']:>8.2f} | {row['gain_pct']:>8.2f}"
        )


if __name__ == "__main__":
    main()
