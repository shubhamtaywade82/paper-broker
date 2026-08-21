export type ErrorSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'FATAL';

export type ErrorClassification = 'RECOVERABLE' | 'DEGRADED' | 'TRADING_UNSAFE' | 'FATAL';

export interface IncidentReport {
  incidentId: string;
  timestampUtc: string;
  severity: ErrorSeverity;
  classification: ErrorClassification;
  component: string;
  provider?: string;
  symbol?: string;
  message: string;
  stack?: string;
  actionTaken?: string;
  context?: Record<string, unknown>;
  occurrenceCount: number;
}

export interface ErrorReportInput {
  component: string;
  error: Error | string | unknown;
  severity?: ErrorSeverity;
  classification?: ErrorClassification;
  provider?: string;
  symbol?: string;
  actionTaken?: string;
  context?: Record<string, unknown>;
}

export interface RecoveryReportInput {
  component: string;
  provider?: string;
  symbol?: string;
  downtimeMs?: number;
  message: string;
}
