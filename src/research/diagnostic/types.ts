export interface FunnelStageStats {
  gateName: string;
  sequentialCandidates: number;
  sequentialPassed: number;
  sequentialRejected: number;
  sequentialPassRatePct: number;
  independentPassed: number;
  independentPassRatePct: number;
  primaryRejectionReasons: Record<string, number>;
}

export interface DiagnosticCandidateTrace {
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  failedStage: string;
  passedGates: string[];
  rejectionReasons: string[];
  confluenceScore: number;
  riskRewardRatio: number | null;
}

export interface DiagnosticReport {
  symbol: string;
  totalCandles5m: number;
  warmupCandles: number;
  evaluatedCandles: number;
  startTimestamp: number;
  endTimestamp: number;
  durationDays: number;
  datasetHash: string;
  configHash: string;
  overallFunnel: FunnelStageStats[];
  longFunnel: FunnelStageStats[];
  shortFunnel: FunnelStageStats[];
  monthlyBreakdown: Record<string, { totalBars: number; passedStructure: number; readySetups: number; fills: number }>;
  scoreDistribution: Record<string, number>;
  bottleneckCategory: 'NO_STRUCTURE' | 'RETEST_OR_TRIGGER_BOTTLENECK' | 'RR_OR_PLAN_BOTTLENECK' | 'RISK_GATE_BOTTLENECK' | 'FILL_MODEL_BOTTLENECK' | 'TRADE_ACTIVE';
  primaryBottleneckGate: string;
  candidateTracesSample: DiagnosticCandidateTrace[];
  generatedAt: number;
}
