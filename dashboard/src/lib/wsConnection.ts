import { WsMessageSchema, type WsMessage } from './wsContracts.js';

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;
export const HEARTBEAT_STALE_MS = 90_000;

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Backoff: min(cap, base · 2^attempt) + bounded jitter (<= 30% of delay or 1000ms). */
export function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
  const jitter = Math.random() * Math.min(1_000, exp * 0.3);
  return exp + jitter;
}

export class WsConnectionManager {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private status: WsStatus = 'idle';
  private channels: Set<string> = new Set(['*']);
  private statusListeners = new Set<(s: WsStatus) => void>();
  private messageListeners = new Map<string, Set<(m: WsMessage) => void>>();

  get statusSnapshot(): WsStatus {
    return this.status;
  }

  get reconnectAttempt(): number {
    return this.attempt;
  }

  subscribe(channels: string[]): void {
    channels.forEach((c) => this.channels.add(c));
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription();
    }
  }

  on(channel: string, fn: (m: WsMessage) => void): () => void {
    if (!this.messageListeners.has(channel)) {
      this.messageListeners.set(channel, new Set());
    }
    this.messageListeners.get(channel)!.add(fn);
    return () => this.messageListeners.get(channel)?.delete(fn);
  }

  onStatus(fn: (s: WsStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  connect(url?: string): void {
    if (typeof window === 'undefined' && typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const wsUrl =
      url ??
      (typeof location !== 'undefined'
        ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
        : 'ws://localhost:8080/ws');

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.attempt = 0;
        this.lastMessageAt = Date.now();
        this.setStatus('open');
        this.sendSubscription();
        this.startStaleDetection();
      };

      this.ws.onmessage = (ev: MessageEvent) => {
        this.lastMessageAt = Date.now();
        try {
          const raw = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
          const parsed = WsMessageSchema.parse(raw);
          this.dispatch(parsed);
        } catch {
          // Drop malformed frames at boundary
        }
      };

      this.ws.onclose = () => {
        this.stopStaleDetection();
        if (this.status !== 'closed') {
          this.scheduleReconnect(url);
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect(url);
    }
  }

  disconnect(): void {
    this.setStatus('closed');
    this.stopStaleDetection();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(url?: string): void {
    if (this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt++);
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(url);
    }, delay);
  }

  private startStaleDetection(): void {
    this.stopStaleDetection();
    this.staleTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > HEARTBEAT_STALE_MS) {
        this.ws?.close();
      }
    }, 15_000);
  }

  private stopStaleDetection(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private sendSubscription(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', channels: [...this.channels] }));
    }
  }

  private dispatch(m: WsMessage): void {
    this.messageListeners.get(m.channel)?.forEach((fn) => fn(m));
    this.messageListeners.get('*')?.forEach((fn) => fn(m));
  }

  private setStatus(s: WsStatus): void {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }
}

export const wsManager = new WsConnectionManager();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wsManager.statusSnapshot !== 'open') {
      wsManager.connect();
    }
  });
}
