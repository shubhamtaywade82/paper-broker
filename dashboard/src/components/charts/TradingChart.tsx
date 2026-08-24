import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

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
}

export function TradingChart({
  candles = [],
  markers = [],
  height = 360,
  symbol = 'SOLUSDT',
  timeframe = '15m',
  onTimeframeChange,
  showVolume = true,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

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
        vertLine: {
          color: '#3b82f6',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1a2332',
        },
        horzLine: {
          color: '#3b82f6',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1a2332',
        },
      },
      rightPriceScale: {
        borderColor: '#1b2537',
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.25 : 0.1,
        },
      },
      timeScale: {
        borderColor: '#1b2537',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#05cd99',
      downColor: '#ff4d4f',
      borderVisible: false,
      wickUpColor: '#05cd99',
      wickDownColor: '#ff4d4f',
    });

    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    if (showVolume) {
      volumeSeries = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
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
    };
  }, [height, showVolume]);

  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const formattedCandles: CandlestickData[] = candles
      .map((c) => ({
        time: Math.floor(c.openTime / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (Number(a.time) - Number(b.time)));

    // Deduplicate timestamps if any
    const uniqueCandles: CandlestickData[] = [];
    const seen = new Set<number>();
    for (const c of formattedCandles) {
      if (!seen.has(Number(c.time))) {
        seen.add(Number(c.time));
        uniqueCandles.push(c);
      }
    }

    candleSeriesRef.current.setData(uniqueCandles);

    if (volumeSeriesRef.current && showVolume) {
      const volumeData: HistogramData[] = candles
        .map((c) => ({
          time: Math.floor(c.openTime / 1000) as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(5, 205, 153, 0.25)' : 'rgba(255, 77, 79, 0.25)',
        }))
        .sort((a, b) => (Number(a.time) - Number(b.time)));

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

    if (markers.length > 0) {
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

      candleSeriesRef.current.setMarkers(seriesMarkers);
    } else {
      candleSeriesRef.current.setMarkers([]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, markers, showVolume]);

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  return (
    <div className="bg-[#0b101b] rounded-xl border border-[#1b2537] overflow-hidden flex flex-col">
      <div className="h-10 px-4 border-b border-[#1b2537] flex items-center justify-between bg-[#0f1623]/80">
        <div className="flex items-center gap-3">
          <span className="font-bold text-white font-mono text-xs">{symbol}</span>
          <span className="text-[10px] text-gray-500 font-mono">CANDLESTICK + VOLUME</span>
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
      <div ref={chartContainerRef} className="w-full" style={{ height }} />
    </div>
  );
}
