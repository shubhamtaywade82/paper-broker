import type { BinanceClient } from '@nemesis-oss/binance-sdk';
import type { MarketStateManager } from '../market/MarketState.js';
import {
  normalizeBookTicker,
  normalizeAggTrade,
  normalizeMarkPrice,
  normalizeKline,
  type NormalizedKline,
} from './normalizers.js';

export interface StreamHandlerOptions {
  symbols: string[];
  timeframes: string[];
  marketState: MarketStateManager;
  onKlineTick?: (kline: NormalizedKline) => void;
  onKlineClose?: (kline: NormalizedKline) => void;
  onBookTicker?: (symbol: string, bid: number, ask: number, bidQty: number, askQty: number) => void;
  onAggTrade?: (symbol: string, price: number, qty: number) => void;
  onSystemEvent?: (type: string, payload: Record<string, unknown>) => void;
}

export class BinanceStreamHandler {
  private client: BinanceClient;
  private options: StreamHandlerOptions;
  private reconnectTimer?: NodeJS.Timeout;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;

  constructor(client: BinanceClient, options: StreamHandlerOptions) {
    this.client = client;
    this.options = options;
  }

  async connect(): Promise<void> {
    const streams: string[] = [];

    for (const symbol of this.options.symbols) {
      streams.push(
        this.client.futures.ws.bookTicker(symbol),
        this.client.futures.ws.aggTrade(symbol),
        this.client.futures.ws.markPrice(symbol, '1s')
      );

      for (const interval of this.options.timeframes) {
        streams.push(this.client.futures.ws.kline(symbol, interval as Parameters<typeof this.client.futures.ws.kline>[1]));
      }
    }

    console.log(`[WS] Subscribing to ${streams.length} streams for ${this.options.symbols.length} symbols`);

    this.client.futures.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.options.onSystemEvent?.('WS_CONNECTED', { streams: streams.length });
      console.log('[WS] Connected to Binance Futures WebSocket');
    });

    this.client.futures.ws.on('message', (streamName: string, payload: Record<string, unknown>) => {
      this.handleMessage(streamName, payload);
    });

    this.client.futures.ws.on('error', (err: Error) => {
      this.options.onSystemEvent?.('WS_ERROR', { error: err.message });
      console.error('[WS] Error:', err.message);
    });

    this.client.futures.ws.on('close', () => {
      this.isConnected = false;
      this.options.onSystemEvent?.('WS_DISCONNECTED', {});
      console.warn('[WS] Disconnected from Binance WebSocket');
      this.scheduleReconnect(streams);
    });

    this.client.futures.ws.subscribe(streams);
  }

  private handleMessage(streamName: string, payload: Record<string, unknown>): void {
    try {
      if (streamName.includes('@bookTicker')) {
        const normalized = normalizeBookTicker(payload);
        if (normalized) {
          this.options.marketState.onBookTicker(
            normalized.symbol,
            normalized.bid,
            normalized.ask,
            normalized.bidQty,
            normalized.askQty,
            String(normalized.eventTime)
          );
          this.options.onBookTicker?.(normalized.symbol, normalized.bid, normalized.ask, normalized.bidQty, normalized.askQty);
        }
      } else if (streamName.includes('@aggTrade')) {
        const normalized = normalizeAggTrade(payload);
        if (normalized) {
          this.options.marketState.onAggTrade(
            normalized.symbol,
            normalized.price,
            normalized.quantity,
            String(normalized.eventTime)
          );
          this.options.onAggTrade?.(normalized.symbol, normalized.price, normalized.quantity);
        }
      } else if (streamName.includes('@markPrice')) {
        const normalized = normalizeMarkPrice(payload);
        if (normalized) {
          this.options.marketState.onMarkPrice(
            normalized.symbol,
            normalized.markPrice,
            normalized.indexPrice,
            normalized.fundingRate,
            String(normalized.nextFundingTime),
            String(normalized.eventTime)
          );
        }
      } else if (streamName.includes('@kline')) {
        const normalized = normalizeKline(payload);
        if (normalized) {
          this.options.onKlineTick?.(normalized);
          if (normalized.closed) {
            this.options.onKlineClose?.(normalized);
          }
        }
      }
    } catch (error) {
      console.error('[WS] Message handler error:', error);
    }
  }

  private scheduleReconnect(streams: string[]): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      this.options.onSystemEvent?.('WS_MAX_RECONNECTS_REACHED', { attempts: this.reconnectAttempts });
      return;
    }

    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.options.onSystemEvent?.('WS_RECONNECTING', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.options.onSystemEvent?.('WS_RESUBSCRIBED', { streams: streams.length });
      this.client.futures.ws.subscribe(streams);
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    const ws = this.client.futures.ws as unknown as { disconnect?: () => void };
    ws.disconnect?.();
    this.isConnected = false;
  }

  isWsConnected(): boolean {
    return this.isConnected;
  }
}