import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, Rocket, Search } from 'lucide-react'
import { api, type StockGrowthRow } from '@/lib/api'
import { QK } from '@/lib/queryKeys'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StockGrowthChart } from '@/components/stock-growth/StockGrowthChart'
import { toast } from '@/components/Toast'
import { cn } from '@/lib/cn'

const PAGE_SIZE = 50

type SortKey = 'gain_pct' | 'gain_times' | 'start_date' | 'end_date' | 'symbol' | 'start_price' | 'peak_price'

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(Number(v))) return '--'
  return Number(v).toFixed(digits)
}

function fmtPct(v: number | null | undefined) {
  if (v == null || Number.isNaN(Number(v))) return '--'
  return `${Number(v).toFixed(2)}%`
}

export function StockGrowth() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [years, setYears] = useState(10)
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState<SortKey>('gain_pct')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<StockGrowthRow | null>(null)

  const status = useQuery({
    queryKey: QK.stockGrowthStatus,
    queryFn: api.stockGrowthStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  })

  const list = useQuery({
    queryKey: QK.stockGrowth(search, years, sortBy, sortOrder, page),
    queryFn: () => api.stockGrowthList({
      q: search || undefined,
      years,
      sort_by: sortBy,
      sort_order: sortOrder,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    }),
    enabled: !status.data?.running,
  })

  const kline = useQuery({
    queryKey: selected
      ? QK.stockGrowthKline(selected.symbol, selected.start_date, selected.end_date)
      : ['stock-growth-kline', 'none'],
    queryFn: () => api.stockGrowthKline(
      selected!.symbol,
      selected!.start_date,
      selected!.end_date,
      selected!.peak_date,
    ),
    enabled: !!selected,
  })

  const refresh = useMutation({
    mutationFn: () => api.stockGrowthRefresh(false),
    onSuccess: (res) => {
      toast(res.message, 'success')
      qc.invalidateQueries({ queryKey: QK.stockGrowthStatus })
    },
  })

  useEffect(() => {
    if (!status.data?.running && status.data?.stage === 'done') {
      qc.invalidateQueries({ queryKey: ['stock-growth'] })
    }
  }, [status.data?.running, status.data?.stage, qc])

  const rows = list.data?.rows ?? []
  const meta = list.data?.meta
  const running = status.data?.running

  useEffect(() => {
    if (rows.length > 0 && !selected) {
      setSelected(rows[0])
    }
  }, [rows, selected])

  useEffect(() => {
    if (selected && rows.length > 0 && !rows.some(r => r.symbol === selected.symbol)) {
      setSelected(rows[0] ?? null)
    }
  }, [rows, selected])

  const totalPages = useMemo(() => {
    const total = list.data?.total ?? 0
    return Math.max(1, Math.ceil(total / PAGE_SIZE))
  }, [list.data?.total])

  const chartData = useMemo(
    () => (kline.data?.rows ?? []).map(r => ({
      date: r.date.slice(0, 10),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume ?? 0),
    })),
    [kline.data?.rows],
  )

  const toggleSort = useCallback((key: SortKey) => {
    setPage(0)
    if (sortBy === key) {
      setSortOrder(o => (o === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(key)
      setSortOrder('desc')
    }
  }, [sortBy])

  const onSearch = useCallback(() => {
    setPage(0)
    setSearch(q.trim())
    setSelected(null)
  }, [q])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="三年五倍"
        subtitle="前复权 · 756 交易日 · 统计区间：过去 10 年（约 2016~今）"
        right={
          <button
            type="button"
            disabled={running || refresh.isPending}
            onClick={() => refresh.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
          >
            {(running || refresh.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {running ? '扫描中…' : '重新扫描'}
          </button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 lg:flex-row lg:gap-4 lg:p-5">
        {/* 左侧：清单 */}
        <div className="flex min-h-0 w-full flex-col gap-2 lg:w-[min(58%,680px)] lg:shrink-0">
          {running && (
            <div className="rounded-xl border border-border bg-surface/60 px-3 py-2 text-xs text-muted">
              <div className="mb-1 flex justify-between">
                <span>{status.data?.message || '扫描中'}</span>
                <span>{status.data?.pct ?? 0}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-base">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${status.data?.pct ?? 0}%` }} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSearch() }}
                placeholder="搜索代码或名称…"
                className="w-full rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-xs outline-none focus:border-brand"
              />
            </div>
            <button type="button" onClick={onSearch} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs hover:bg-surface-hover">
              搜索
            </button>
            <select
              value={years}
              onChange={e => { setYears(Number(e.target.value)); setPage(0); setSelected(null) }}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none"
            >
              <option value={10}>过去 10 年</option>
              <option value={0}>不限时间</option>
            </select>
            {list.data && (
              <span className="text-[10px] text-muted">共 {list.data.total} 只</span>
            )}
          </div>

          {meta && (
            <div className="rounded-lg border border-border/60 bg-surface/40 px-2.5 py-1.5 text-[10px] text-muted">
              {meta.analysis_start ?? '不限'} ~ {meta.analysis_end} · 阈值 {meta.gain_threshold}x
            </div>
          )}

          {list.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Rocket} title="暂无数据" hint="点击「重新扫描」生成清单" />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
                  <tr className="border-b border-border text-muted">
                    <th className="px-2 py-1.5 w-8">#</th>
                    <SortTh label="代码" active={sortBy === 'symbol'} order={sortOrder} onClick={() => toggleSort('symbol')} />
                    <th className="px-2 py-1.5">名称</th>
                    <SortTh label="增长区间" active={sortBy === 'start_date'} order={sortOrder} onClick={() => toggleSort('start_date')} />
                    <th className="px-2 py-1.5">峰值日</th>
                    <th className="px-2 py-1.5 text-right">初始价</th>
                    <th className="px-2 py-1.5 text-right">最高价</th>
                    <SortTh label="涨幅" active={sortBy === 'gain_pct'} order={sortOrder} onClick={() => toggleSort('gain_pct')} className="text-right" />
                    <SortTh label="倍数" active={sortBy === 'gain_times'} order={sortOrder} onClick={() => toggleSort('gain_times')} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.symbol}
                      className={cn(
                        'border-b border-border/40 cursor-pointer transition-colors',
                        selected?.symbol === row.symbol ? 'bg-brand/10' : 'hover:bg-surface-hover/60',
                      )}
                      onClick={() => setSelected(row)}
                    >
                      <td className="px-2 py-1.5 text-muted">{page * PAGE_SIZE + i + 1}</td>
                      <td className="px-2 py-1.5 font-mono text-brand whitespace-nowrap">{row.symbol}</td>
                      <td className="px-2 py-1.5 max-w-[80px] truncate" title={row.name}>{row.name || '--'}</td>
                      <td className="px-2 py-1.5 text-muted whitespace-nowrap">
                        <span className="text-foreground">{row.start_date}</span>
                        <span className="mx-0.5">~</span>
                        <span>{row.end_date}</span>
                      </td>
                      <td className="px-2 py-1.5 text-muted whitespace-nowrap">{row.peak_date}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(row.start_price)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-bull">{fmtNum(row.peak_price)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-bull">{fmtPct(row.gain_pct)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(row.gain_times, 1)}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span>第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-1">
                <button type="button" disabled={page <= 0} onClick={() => { setPage(p => p - 1); setSelected(null) }} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">上一页</button>
                <button type="button" disabled={page + 1 >= totalPages} onClick={() => { setPage(p => p + 1); setSelected(null) }} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">下一页</button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：K 线验证 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-surface/30">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">
              点击左侧股票查看 K 线
            </div>
          ) : (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm font-semibold text-brand">{selected.symbol}</span>
                  <span className="text-sm">{selected.name}</span>
                  <span className="text-xs text-bull font-medium">{fmtPct(selected.gain_pct)} · {fmtNum(selected.gain_times, 1)}x</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted sm:grid-cols-4">
                  <span>起始 <b className="text-foreground">{selected.start_date}</b> @ {fmtNum(selected.start_price)}</span>
                  <span>峰值 <b className="text-foreground">{selected.peak_date}</b> @ {fmtNum(selected.peak_price)}</span>
                  <span>窗口末 <b className="text-foreground">{selected.end_date}</b></span>
                  <span className="text-[10px]">前复权 · 与扫描同源缓存</span>
                </div>
                <div className="mt-2 flex gap-3 text-[10px]">
                  <Legend color="#3B82F6" label="起始日" />
                  <Legend color="#F59E0B" label="峰值日" />
                  <Legend color="#8B5CF6" label="窗口末日" />
                </div>
              </div>

              <div className="relative min-h-[320px] flex-1 p-2">
                {kline.isLoading && (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-base/60 text-xs text-muted">
                    <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />加载 K 线…
                  </div>
                )}
                {kline.isError ? (
                  <div className="flex h-full items-center justify-center text-xs text-danger">
                    K 线加载失败，请确认缓存数据存在
                  </div>
                ) : chartData.length > 0 ? (
                  <StockGrowthChart
                    data={chartData}
                    height={380}
                    markers={{
                      start: selected.start_date,
                      peak: selected.peak_date,
                      end: selected.end_date,
                      startPrice: selected.start_price,
                      peakPrice: selected.peak_price,
                    }}
                    focusRange={{
                      from: selected.start_date,
                      to: selected.end_date,
                    }}
                  />
                ) : !kline.isLoading ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted">暂无 K 线数据</div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function SortTh({
  label,
  active,
  order,
  onClick,
  className,
}: {
  label: string
  active: boolean
  order: 'asc' | 'desc'
  onClick: () => void
  className?: string
}) {
  return (
    <th className={cn('px-2 py-1.5 font-medium', className)}>
      <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-0.5 hover:text-foreground', active && 'text-foreground')}>
        {label}
        {active && <span className="text-[9px]">{order === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
  )
}
