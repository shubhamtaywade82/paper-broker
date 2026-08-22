export interface PaperEvent {
  eventId: string;
  timestamp: number;
  symbol: string;
  orderId?: string;
  positionId?: string;
  signalKey?: string;
  eventType: string;
  price?: number;
  quantity?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export class PaperEventJournal {
  private events: PaperEvent[] = [];

  recordEvent(event: Omit<PaperEvent, 'eventId'>): PaperEvent {
    const fullEvent: PaperEvent = {
      eventId: `EVT:${this.events.length + 1}:${event.timestamp}`,
      ...event,
    };
    this.events.push(fullEvent);
    return fullEvent;
  }

  getEvents(symbol?: string): PaperEvent[] {
    if (!symbol) return [...this.events];
    return this.events.filter((e) => e.symbol === symbol);
  }

  clear(): void {
    this.events = [];
  }
}
