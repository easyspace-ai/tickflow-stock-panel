import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import type { OHLC } from '@/components/CandlestickChart'

const THEME = {
  background: 'transparent',
  textColor: '#A1A1AA',
  gridColor: 'rgba(255,255,255,0.04)',
  borderColor: '#27272A',
  bull: '#F04438',
  bear: '#12B76A',
  volBull: 'rgba(240,68,56,0.4)',
  volBear: 'rgba(18,183,106,0.4)',
  markerStart: '#3B82F6',
  markerPeak: '#F59E0B',
  markerEnd: '#8B5CF6',
}

export interface GrowthWindowMarkers {
  start: string
  peak: string
  end: string
  startPrice?: number
  peakPrice?: number
}

interface Props {
  data: OHLC[]
  height?: number
  markers?: GrowthWindowMarkers
  focusRange?: { from: string; to: string }
}

export function StockGrowthChart({ data, height = 420, markers, focusRange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { color: THEME.background },
        textColor: THEME.textColor,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: THEME.gridColor },
        horzLines: { color: THEME.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelVisible: true },
        horzLine: { labelVisible: true },
      },
      rightPriceScale: { borderColor: THEME.borderColor },
      timeScale: {
        borderColor: THEME.borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candle = chart.addCandlestickSeries({
      upColor: THEME.bull,
      downColor: THEME.bear,
      borderUpColor: THEME.bull,
      borderDownColor: THEME.bear,
      wickUpColor: THEME.bull,
      wickDownColor: THEME.bear,
      lastValueVisible: true,
      priceLineVisible: false,
    })

    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candle
    volRef.current = volume

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
    }
  }, [height])

  useEffect(() => {
    if (!chartRef.current || !candleRef.current || !volRef.current || data.length === 0) return

    const candles = data.map(d => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    })) as CandlestickData[]

    candleRef.current.setData(candles)
    volRef.current.setData(
      data.map(d => ({
        time: d.date as Time,
        value: d.volume ?? 0,
        color: d.close >= d.open ? THEME.volBull : THEME.volBear,
      })) as HistogramData[],
    )

    if (markers) {
      const seriesMarkers: SeriesMarker<Time>[] = [
        {
          time: markers.start as Time,
          position: 'belowBar',
          color: THEME.markerStart,
          shape: 'arrowUp',
          text: `起始 ${markers.startPrice?.toFixed(2) ?? ''}`,
        },
        {
          time: markers.peak as Time,
          position: 'aboveBar',
          color: THEME.markerPeak,
          shape: 'circle',
          text: `峰值 ${markers.peakPrice?.toFixed(2) ?? ''}`,
        },
        {
          time: markers.end as Time,
          position: 'belowBar',
          color: THEME.markerEnd,
          shape: 'square',
          text: '窗口末',
        },
      ]
      candleRef.current.setMarkers(seriesMarkers)
    } else {
      candleRef.current.setMarkers([])
    }

    const ts = chartRef.current.timeScale()
    if (focusRange) {
      ts.setVisibleRange({
        from: focusRange.from as Time,
        to: focusRange.to as Time,
      })
    } else if (data.length > 60) {
      const startIdx = Math.max(0, data.length - 120)
      ts.setVisibleRange({
        from: data[startIdx].date as Time,
        to: data[data.length - 1].date as Time,
      })
    } else {
      ts.fitContent()
    }
  }, [data, markers, focusRange])

  return <div ref={containerRef} className="w-full" style={{ height }} />
}
