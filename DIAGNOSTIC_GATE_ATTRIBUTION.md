# 12-MONTH SOLUSDT DIAGNOSTIC GATE ATTRIBUTION AUDIT

## 1. Executive Summary
- **Symbol**: undefined (Binance USDⓈ-M Perpetual Futures)
- **Period**: 2025-08-27T03:05:00.000Z to 2026-08-22T08:04:59.999Z (360.2 days)
- **Total 5m Candles Evaluated**: 103680
- **Dataset Hash**: `4a77a5f32184699ae3275c82b7dac4dd`
- **Config Hash**: `CFG:SOLUSDT:1.0.0:0.01`
- **Identified Bottleneck Category**: **`NO_STRUCTURE`**
- **Primary Bottleneck Gate**: **`4H Regime`**

## 2. Overall Pipeline Gate Attribution
| Gate Name | Sequential Candidates | Passed | Rejected | Sequential Pass % | Independent Passed | Independent Pass % | Primary Rejection Reason |
|---|---|---|---|---|---|---|---|
| **4H Regime** | 207480 | 0 | 207480 | 0% | 0 | 0% | `4H_TREND_MISALIGNED` |
| **1H Bias** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **15m Structure** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **Liquidity Sweep** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **FVG / OB Location** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **Zone Retest** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **5m Trigger** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **Confluence Score** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **Execution Plan (R:R)** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **Risk Gate** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |
| **Paper Fill** | 0 | 0 | 0 | 0% | 0 | 0% | `NONE` |

## 3. Directional Funnel Comparison

### LONG Direction Funnel
| Gate Name | Candidates | Passed | Rejected | Pass % | Primary Rejection Reason |
|---|---|---|---|---|---|
| **4H Regime** | 103740 | 0 | 103740 | 0% | `4H_TREND_MISALIGNED` |
| **1H Bias** | 0 | 0 | 0 | 0% | `NONE` |
| **15m Structure** | 0 | 0 | 0 | 0% | `NONE` |
| **Liquidity Sweep** | 0 | 0 | 0 | 0% | `NONE` |
| **FVG / OB Location** | 0 | 0 | 0 | 0% | `NONE` |
| **Zone Retest** | 0 | 0 | 0 | 0% | `NONE` |
| **5m Trigger** | 0 | 0 | 0 | 0% | `NONE` |
| **Confluence Score** | 0 | 0 | 0 | 0% | `NONE` |
| **Execution Plan (R:R)** | 0 | 0 | 0 | 0% | `NONE` |
| **Risk Gate** | 0 | 0 | 0 | 0% | `NONE` |
| **Paper Fill** | 0 | 0 | 0 | 0% | `NONE` |

### SHORT Direction Funnel
| Gate Name | Candidates | Passed | Rejected | Pass % | Primary Rejection Reason |
|---|---|---|---|---|---|
| **4H Regime** | 103740 | 0 | 103740 | 0% | `4H_TREND_MISALIGNED` |
| **1H Bias** | 0 | 0 | 0 | 0% | `NONE` |
| **15m Structure** | 0 | 0 | 0 | 0% | `NONE` |
| **Liquidity Sweep** | 0 | 0 | 0 | 0% | `NONE` |
| **FVG / OB Location** | 0 | 0 | 0 | 0% | `NONE` |
| **Zone Retest** | 0 | 0 | 0 | 0% | `NONE` |
| **5m Trigger** | 0 | 0 | 0 | 0% | `NONE` |
| **Confluence Score** | 0 | 0 | 0 | 0% | `NONE` |
| **Execution Plan (R:R)** | 0 | 0 | 0 | 0% | `NONE` |
| **Risk Gate** | 0 | 0 | 0 | 0% | `NONE` |
| **Paper Fill** | 0 | 0 | 0 | 0% | `NONE` |

## 4. Confluence Score Distribution Across Evaluated Candidates
| Score Range | Count |
|---|---|
| **0-49** | 0 |
| **50-59** | 0 |
| **60-64** | 0 |
| **65-69** | 0 |
| **70-74** | 0 |
| **75-79** | 0 |
| **80-84** | 0 |
| **85-89** | 0 |
| **90+** | 0 |

## 5. Rejection Reason Attribution Breakdown
```json
{
  "4H Regime": {
    "4H_TREND_MISALIGNED": 207480
  }
}
```

## 6. Diagnostic Verdict & Architectural Conclusion
- **Root Bottleneck**: **4H Regime** (NO_STRUCTURE)
- **Gate Findings**: All 103,740 5m candles were evaluated point-in-time without modifying production strategy parameters.
