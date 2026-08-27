// @ts-nocheck - lightweight-charts v5 typings incomplete; runtime API verified
import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useStore } from '../../store/useStore';

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export interface TradingChartProps {
  candles?: Array<{
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
  }>;
  markers?: ChartMarker[];
  height?: number;
  symbol?: string;
  timeframe?: string;
  onTimeframeChange?: (tf: string) => void;
  showVolume?: boolean;
  loading?: boolean;
}

export function TradingChart({
  candles = [],
  markers = [],
  height = 360,
  symbol = 'SOLUSDT',
  timeframe = '15m',
  onTimeframeChange,
  showVolume = true,
  loading = false,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastBarRef = useRef<CandlestickData<Time> | null>(null);
  const initialFitDoneRef = useRef(false);

  const livePrice = useStore((s) => s.livePrice[symbol] ?? s.tickers[symbol]?.price);
  const closedCandle = useStore((s) => s.closedCandle[`${symbol}:${timeframe}`]);
  const prevSymbolRef = useRef(symbol);

  // Initialize Lightweight Chart instance
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0b101b' },
        textColor: '#8492a6',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(27, 37, 55, 0.6)' },
        horzLines: { color: 'rgba(27, 37, 55, 0.6)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#3b82f6', width: 1, style: 3, labelBackgroundColor: '#1a2332' },
        horzLine: { color: '#3b82f6', width: 1, style: 3, labelBackgroundColor: '#1a2332' },
      },
      rightPriceScale: {
        borderColor: '#1b2537',
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.25 : 0.1 },
      },
      timeScale: {
        borderColor: '#1b2537',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // @ts-ignore - v5 typings incomplete
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#05cd99',
      downColor: '#ff4d4f',
      borderVisible: false,
      wickUpColor: '#05cd99',
      wickDownColor: '#ff4d4f',
    });

    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    if (showVolume) {
      // @ts-ignore - v5 typings incomplete
      volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries?.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      lastBarRef.current = null;
    };
  }, [height, showVolume]);

  // Update historical dataset when candles or symbol changes
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    if (prevSymbolRef.current !== symbol) {
      initialFitDoneRef.current = false;
      prevSymbolRef.current = symbol;
    }

    const formattedCandles: CandlestickData[] = candles
      .map((c) => ({
        time: Math.floor(c.openTime / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));

    const uniqueCandles: CandlestickData[] = [];
    const seen = new Set<number>();
    for (const c of formattedCandles) {
      if (!seen.has(Number(c.time))) {
        seen.add(Number(c.time));
        uniqueCandles.push(c);
      }
    }

    const lastBar = uniqueCandles[uniqueCandles.length - 1];
    if (lastBar && livePrice) {
      const liveBar: CandlestickData = {
        time: lastBar.time,
        open: lastBar.open,
        high: Math.max(lastBar.high, livePrice),
        low: Math.min(lastBar.low, livePrice),
        close: livePrice,
      };
      uniqueCandles[uniqueCandles.length - 1] = liveBar;
      lastBarRef.current = liveBar;
    } else {
      lastBarRef.current = lastBar || null;
    }

    candleSeriesRef.current.setData(uniqueCandles);

    if (volumeSeriesRef.current && showVolume) {
      const volumeData: HistogramData[] = candles
        .map((c) => ({
          time: Math.floor(c.openTime / 1000) as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(5, 205, 153, 0.25)' : 'rgba(255, 77, 79, 0.25)',
        }))
        .sort((a, b) => Number(a.time) - Number(b.time));

      const uniqueVolumes: HistogramData[] = [];
      const volSeen = new Set<number>();
      for (const v of volumeData) {
        if (!volSeen.has(Number(v.time))) {
          volSeen.add(Number(v.time));
          uniqueVolumes.push(v);
        }
      }
      volumeSeriesRef.current.setData(uniqueVolumes);
    }

    applyChartMarkers(candleSeriesRef.current, markers);

    if (!initialFitDoneRef.current) {
      chartRef.current?.timeScale().fitContent();
      initialFitDoneRef.current = true;
    }
  }, [candles, markers, showVolume, symbol, livePrice]);

  // Real-time live price tick updates on the forming candle bar
  useEffect(() => {
    if (!candleSeriesRef.current || !livePrice) return;

    if (!lastBarRef.current) {
      const nowTime = Math.floor(Date.now() / 1000) as UTCTimestamp;
      const newBar: CandlestickData = {
        time: nowTime,
        open: livePrice,
        high: livePrice,
        low: livePrice,
        close: livePrice,
      };
      lastBarRef.current = newBar;
      candleSeriesRef.current.update(newBar);
      return;
    }

    const currentBar = lastBarRef.current;
    const updatedBar: CandlestickData = {
      time: currentBar.time,
      open: currentBar.open,
      high: Math.max(currentBar.high, livePrice),
      low: Math.min(currentBar.low, livePrice),
      close: livePrice,
    };

    lastBarRef.current = updatedBar;
    candleSeriesRef.current.update(updatedBar);
  }, [livePrice]);

  // Authoritative candle close: correct the just-closed bar
  useEffect(() => {
    if (!candleSeriesRef.current || !closedCandle || !lastBarRef.current) return;

    const closedTime = Math.floor(closedCandle.openTime / 1000) as UTCTimestamp;
    if (Number(closedTime) < Number(lastBarRef.current.time)) return;

    const finalBar: CandlestickData = {
      time: closedTime,
      open: closedCandle.open,
      high: closedCandle.high,
      low: closedCandle.low,
      close: closedCandle.close,
    };
    candleSeriesRef.current.update(finalBar);
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.update({
        time: closedTime,
        value: closedCandle.volume,
        color: closedCandle.close >= closedCandle.open ? 'rgba(5, 205, 153, 0.25)' : 'rgba(255, 77, 79, 0.25)',
      });
    }

    const stepSec = TIMEFRAME_SECONDS[timeframe];
    if (!stepSec) {
      lastBarRef.current = finalBar;
      return;
    }

    const nextBar: CandlestickData = {
      time: (Number(closedTime) + stepSec) as UTCTimestamp,
      open: closedCandle.close,
      high: closedCandle.close,
      low: closedCandle.close,
      close: closedCandle.close,
    };
    candleSeriesRef.current.update(nextBar);
    lastBarRef.current = nextBar;
  }, [closedCandle, timeframe]);

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  return (
    <div className="bg-[#0b101b] rounded-xl border border-[#1b2537] overflow-hidden flex flex-col">
      <div className="h-10 px-4 border-b border-[#1b2537] flex items-center justify-between bg-[#0f1623]/80">
        <div className="flex items-center gap-3">
          <span className="font-bold text-white font-mono text-xs flex items-center gap-1.5">
            {symbol}
            {livePrice && (
              <span className="text-emerald-400 font-bold ml-1 text-xs">
                ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </span>
            )}
          </span>
          <span className="text-[10px] text-gray-500 font-mono hidden sm:inline flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            LIVE TICK FEED
          </span>
        </div>
        {onTimeframeChange && (
          <div className="flex items-center gap-1">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40 font-bold'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative w-full" style={{ height }}>
        <div ref={chartContainerRef} className="w-full h-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0b101b]/80 pointer-events-none">
            <span className="text-gray-500 text-xs font-mono animate-pulse">
              Loading {symbol} candles...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function applyChartMarkers(
  series: ISeriesApi<'Candlestick'>,
  markers: ChartMarker[]
): void {
  if (markers.length === 0) {
    createSeriesMarkers(series, []);
    return;
  }

  const seriesMarkers: SeriesMarker<Time>[] = markers
    .map((m) => ({
      time: Math.floor(m.time / 1000) as UTCTimestamp,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text,
    }))
    .filter((m) => !isNaN(Number(m.time)) && Number(m.time) > 0)
    .sort((a, b) => Number(a.time) - Number(b.time));

  createSeriesMarkers(series, seriesMarkers);
}
