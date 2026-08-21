import { ulid } from 'ulid';
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

    const dedupeKey = `${input.component}:${input.provider || ''}:${message.slice(0, 50)}`;
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
