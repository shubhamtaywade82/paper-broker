import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import type {
  ErrorSeverity,
  ErrorClassification,
  IncidentReport,
  ErrorReportInput,
} from './types.js';

interface DeduplicationState {
  incidentId: string;
  firstSeenMs: number;
  lastSeenMs: number;
  count: number;
}

export class ErrorNormalizer {
  private dedupeMap = new Map<string, DeduplicationState>();
  private incidentHistory: IncidentReport[] = [];
  private dedupeWindowMs: number;

  constructor(dedupeWindowMs = 60000) {
    this.dedupeWindowMs = dedupeWindowMs;
  }

  private generateIncidentId(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const shortId = ulid().slice(-5);
    return `INC-${dateStr}-${shortId}`;
  }

  private extractErrorInfo(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
      return { message: error.message, stack: error.stack };
    }
    if (typeof error === 'string') {
      return { message: error };
    }
    return { message: String(error) };
  }

  // Medium finding ("heuristic error classification is fragile"): substring
  // matching on a free-form component name (e.g. "risk", "ws", "stream") can
  // false-positive on an unrelated component whose name happens to contain
  // that substring, or miss a genuinely risk-adjacent component that isn't
  // named that way. Callers that know their own severity can already bypass
  // this by passing `input.classification` explicitly (see normalize()
  // below) — this heuristic is only the fallback when they don't. A more
  // robust fix (an explicit per-component classification registry) is a
  // larger design change than this pass covers.
  private inferClassification(severity: ErrorSeverity, component: string): ErrorClassification {
    if (severity === 'FATAL') return 'FATAL';
    if (severity === 'CRITICAL' || component.toLowerCase().includes('risk') || component.toLowerCase().includes('reconcil')) {
      return 'TRADING_UNSAFE';
    }
    if (severity === 'WARNING' || component.toLowerCase().includes('ws') || component.toLowerCase().includes('stream')) {
      return 'RECOVERABLE';
    }
    return 'DEGRADED';
  }

  public normalize(input: ErrorReportInput): { incident: IncidentReport; shouldAlert: boolean } {
    const { message, stack } = this.extractErrorInfo(input.error);
    const severity: ErrorSeverity = input.severity || 'ERROR';
    const classification: ErrorClassification =
      input.classification || this.inferClassification(severity, input.component);

    // Medium finding ("dedup key truncation causes false collision"):
    // truncating the message to 50 chars meant two genuinely different
    // errors sharing the same first 50 characters (e.g. differing only in a
    // URL, symbol, or ID appended at the end) were treated as the same
    // incident and deduped together. Hash the full message instead — no
    // length limit, negligible collision risk, still a short, stable key.
    const messageHash = createHash('sha1').update(message).digest('hex').slice(0, 16);
    const dedupeKey = `${input.component}:${input.provider || ''}:${messageHash}`;
    const now = Date.now();
    const existing = this.dedupeMap.get(dedupeKey);

    if (existing && now - existing.lastSeenMs < this.dedupeWindowMs) {
      existing.count += 1;
      existing.lastSeenMs = now;
      return {
        incident: {
          incidentId: existing.incidentId,
          timestampUtc: new Date(now).toISOString(),
          severity,
          classification,
          component: input.component,
          provider: input.provider,
          symbol: input.symbol,
          message,
          stack,
          actionTaken: input.actionTaken,
          context: input.context,
          occurrenceCount: existing.count,
        },
        shouldAlert: false, // Suppress spam within window
      };
    }

    const incidentId = this.generateIncidentId();
    this.dedupeMap.set(dedupeKey, {
      incidentId,
      firstSeenMs: now,
      lastSeenMs: now,
      count: 1,
    });

    const result = {
      incident: {
        incidentId,
        timestampUtc: new Date(now).toISOString(),
        severity,
        classification,
        component: input.component,
        provider: input.provider,
        symbol: input.symbol,
        message,
        stack,
        actionTaken: input.actionTaken,
        context: input.context,
        occurrenceCount: 1,
      },
      shouldAlert: true,
    };

    this.incidentHistory.unshift(result.incident);
    if (this.incidentHistory.length > 200) {
      this.incidentHistory.pop();
    }

    return result;
  }

  public getRecentIncidents(limit = 50): IncidentReport[] {
    return this.incidentHistory.slice(0, limit);
  }

  public clearDeduplication(): void {
    this.dedupeMap.clear();
  }
}
