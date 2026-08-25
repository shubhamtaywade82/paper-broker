# Implementation Guide: Profit-Aware Trading System

## Overview

This guide provides step-by-step instructions for integrating the new profit-aware features into your crypto futures trading system. These features transform the system from "always trading" to "trading for specific financial goals."

## Files Created

### Core Profit Goal Module
- `src/trading/goals/ProfitGoalTypes.ts` - Type definitions and interfaces
- `src/trading/goals/ProfitGoalManager.ts` - Core profit tracking logic
- `src/trading/goals/index.ts` - Module exports

### Risk Enhancement
- `src/trading/risk/TrailingStopManager.ts` - Dynamic stop loss management
- `src/trading/risk/RiskEngine.ts` - Updated with profit goal integration

---

## Step 1: Initialize Profit Goal Manager in Main Engine

**File:** `src/engine.ts` (or your main trading engine file)

```typescript
import { ProfitGoalManager, DEFAULT_PROFIT_GOAL_CONFIG } from './trading/goals/index.js';
import { RiskEngine } from './trading/risk/RiskEngine.js';

// In your main engine class initialization:
class TradingEngine {
  private profitGoalManager: ProfitGoalManager;
  private riskEngine: RiskEngine;
  
  constructor() {
    const startingEquity = 10000; // Your initial paper/live account balance
    
    // Initialize profit goal manager with custom configuration
    this.profitGoalManager = new ProfitGoalManager(startingEquity, {
      ...DEFAULT_PROFIT_GOAL_CONFIG,
      dailyTargetPct: 0.02,        // 2% daily target
      weeklyTargetPct: 0.08,       // 8% weekly target
      targetAchievedAction: 'REDUCE_RISK',
      riskReductionFactor: 0.5,    // Cut risk in half after target
      cooldownAfterTargetMs: 3600000, // 1 hour cooldown
    });
    
    // Initialize risk engine with profit goal manager integration
    this.riskEngine = new RiskEngine({
      profitGoalManager: this.profitGoalManager,
    });
    
    // Optional: Initialize trailing stop manager
    this.trailingStopManager = new TrailingStopManager({
      activationThresholdPct: 0.02,
      trailingDistancePct: 0.015,
      breakevenTriggerPct: 0.01,
      enableBreakeven: true,
      enableTrailing: true,
    });
  }
}
```

---

## Step 2: Update PnL on Trade Close

**File:** `src/broker/paper/PaperBroker.ts` or wherever trades are closed

```typescript
import type { ProfitGoalUpdate } from '../trading/goals/index.js';

// When a trade closes:
onTradeClosed(trade: PaperTradeRecord): void {
  // ... existing close logic ...
  
  // Update profit goal manager with realized PnL
  if (this.profitGoalManager && trade.status === 'CLOSED') {
    const update: ProfitGoalUpdate = {
      realizedPnl: trade.netPnl,
      currentEquity: this.accountState.equity,
      timestamp: Date.now(),
    };
    
    this.profitGoalManager.updatePnL(update);
    
    // Log target achievement for visibility
    const achieved = this.profitGoalManager.getAchievedTargets();
    if (achieved.daily || achieved.weekly) {
      logger.info(
        { daily: achieved.daily, weekly: achieved.weekly },
        'Profit target achieved - risk reduction active'
      );
    }
  }
}
```

---

## Step 3: Integrate Trailing Stops

**File:** `src/broker/paper/PaperBroker.ts` or price update handler

```typescript
import { TrailingStopManager } from '../trading/risk/TrailingStopManager.js';

// On every price tick for open positions:
onPriceTick(symbol: string, price: number): void {
  const positions = this.getOpenPositions(symbol);
  
  for (const position of positions) {
    // Update trailing stop
    const result = this.trailingStopManager.updateStopLoss(
      position,
      price,
      Date.now()
    );
    
    // If stop was updated, modify the position's stop loss
    if (result.stopUpdated) {
      this.updatePositionStopLoss(position.id, result.newStop);
      
      logger.info(
        {
          symbol: position.symbol,
          side: position.side,
          oldStop: result.previousStop,
          newStop: result.newStop,
          reason: result.reason,
        },
        'Trailing stop updated'
      );
    }
  }
}

// When position closes, clean up tracker:
onPositionClosed(symbol: string, side: 'LONG' | 'SHORT'): void {
  this.trailingStopManager.onPositionClosed(symbol, side);
}
```

---

## Step 4: Add Daily Reset Logic

**File:** `src/scheduler/jobs.ts` or your cron/scheduler setup

```typescript
import { ProfitGoalManager } from '../trading/goals/index.js';

// Schedule daily reset at market open (e.g., 00:00 UTC for crypto)
scheduleDailyReset(profitGoalManager: ProfitGoalManager, getEquity: () => number) {
  // Cron: 0 0 * * * (midnight UTC)
  setInterval(() => {
    const currentEquity = getEquity();
    profitGoalManager.resetDaily(currentEquity);
    
    logger.info(
      { equity: currentEquity },
      'Daily profit goal reset complete'
    );
  }, 86400000); // 24 hours in ms
}

// Weekly reset (Monday 00:00 UTC)
scheduleWeeklyReset(profitGoalManager: ProfitGoalManager, getEquity: () => number) {
  const now = Date.now();
  const nextMonday = now + (7 - new Date(now).getUTCDay()) * 86400000;
  const delay = nextMonday - now;
  
  setTimeout(() => {
    const currentEquity = getEquity();
    profitGoalManager.resetWeekly(currentEquity);
    
    logger.info(
      { equity: currentEquity },
      'Weekly profit goal reset complete'
    );
    
    // Reschedule for next week
    scheduleWeeklyReset(profitGoalManager, getEquity);
  }, delay);
}
```

---

## Step 5: Dashboard Integration

**File:** `dashboard/src/components/Dashboard.tsx` or similar

```typescript
import { useState, useEffect } from 'react';

interface ProfitGoalState {
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  dailyTargetAchieved: boolean;
  weeklyTargetAchieved: boolean;
  currentRiskMultiplier: number;
}

function ProfitGoalWidget() {
  const [goalState, setGoalState] = useState<ProfitGoalState | null>(null);
  
  useEffect(() => {
    // Fetch from API endpoint you'll create
    fetch('/api/profit-goals/state')
      .then(res => res.json())
      .then(setGoalState);
    
    // Poll every 5 seconds
    const interval = setInterval(() => {
      fetch('/api/profit-goals/state')
        .then(res => res.json())
        .then(setGoalState);
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  if (!goalState) return <div>Loading...</div>;
  
  return (
    <div className="profit-goal-widget">
      <h3>Profit Goals</h3>
      
      <div className="goal-progress">
        <div className="goal-item">
          <span>Daily: ${goalState.dailyPnL.toFixed(2)}</span>
          <ProgressBar 
            percent={calculateDailyProgress(goalState)} 
            achieved={goalState.dailyTargetAchieved}
          />
          {goalState.dailyTargetAchieved && (
            <span className="achieved-badge">✓ Target Hit!</span>
          )}
        </div>
        
        <div className="goal-item">
          <span>Weekly: ${goalState.weeklyPnL.toFixed(2)}</span>
          <ProgressBar 
            percent={calculateWeeklyProgress(goalState)} 
            achieved={goalState.weeklyTargetAchieved}
          />
        </div>
      </div>
      
      {goalState.currentRiskMultiplier < 1.0 && (
        <div className="risk-reduction-alert">
          ⚠️ Risk Reduced: {(goalState.currentRiskMultiplier * 100).toFixed(0)}% of normal
        </div>
      )}
    </div>
  );
}
```

---

## Step 6: API Endpoint for Dashboard

**File:** `src/api/server.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { ProfitGoalManager } from '../trading/goals/index.js';

export function registerProfitGoalEndpoints(
  fastify: FastifyInstance,
  profitGoalManager: ProfitGoalManager
) {
  // Get current profit goal state
  fastify.get('/api/profit-goals/state', async (request, reply) => {
    const state = profitGoalManager.getState();
    const metrics = profitGoalManager.getMetrics();
    
    return {
      state: {
        dailyPnL: state.dailyPnL,
        weeklyPnL: state.weeklyPnL,
        monthlyPnL: state.monthlyPnL,
        dailyStartingEquity: state.dailyStartingEquity,
        weeklyStartingEquity: state.weeklyStartingEquity,
        monthlyStartingEquity: state.monthlyStartingEquity,
        dailyTargetAchieved: state.dailyTargetAchieved,
        weeklyTargetAchieved: state.weeklyTargetAchieved,
        monthlyTargetAchieved: state.monthlyTargetAchieved,
        currentRiskMultiplier: state.currentRiskMultiplier,
        reducedRiskActive: state.reducedRiskActive,
      },
      progress: {
        dailyPercent: profitGoalManager.getDailyProgressPercent(),
        weeklyPercent: profitGoalManager.getWeeklyProgressPercent(),
        monthlyPercent: profitGoalManager.getMonthlyProgressPercent(),
      },
      metrics,
    };
  });
  
  // Get configuration
  fastify.get('/api/profit-goals/config', async (request, reply) => {
    return profitGoalManager.getConfig();
  });
  
  // Update configuration (admin only)
  fastify.put('/api/profit-goals/config', async (request, reply) => {
    // Implement authentication/authorization check here
    const newConfig = request.body as Partial<ProfitGoalConfig>;
    
    // Note: You'll need to add a setter method to ProfitGoalManager
    // Or recreate the instance with new config
    
    return { success: true, config: newConfig };
  });
}
```

---

## Step 7: Enhanced Q-Learning Reward (Optional Advanced)

**File:** `src/strategy/adaptive-supertrend.ts`

```typescript
// Replace the simple reward calculation with enhanced version:

interface EnhancedTradeOutcome {
  realizedReturn: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  holdingTimeBars: number;
  exitType: 'TP_HIT' | 'STOP_LOSS' | 'REVERSAL' | 'TIME_EXIT';
}

function calculateEnhancedReward(outcome: EnhancedTradeOutcome): number {
  const baseReturn = outcome.realizedReturn;
  
  // Time penalty: slow trades are less efficient
  const timePenalty = outcome.holdingTimeBars > 50 ? -0.2 : 0;
  
  // MFE capture ratio: how much of max favorable move did we capture?
  const mfeCapture = outcome.maxFavorableExcursion > 0
    ? outcome.realizedReturn / outcome.maxFavorableExcursion
    : 0;
  const mfeBonus = Math.max(0, mfeCapture * 0.2);
  
  // Exit type bonus: hitting TP is better than reversal close
  let exitBonus = 0;
  switch (outcome.exitType) {
    case 'TP_HIT':
      exitBonus = 0.3;
      break;
    case 'REVERSAL':
      exitBonus = -0.1;
      break;
    case 'TIME_EXIT':
      exitBonus = -0.15;
      break;
  }
  
  // MAE penalty: large drawdowns during trade are bad
  const maePenalty = outcome.maxAdverseExcursion < -0.02 ? -0.15 : 0;
  
  const totalReward = baseReturn + timePenalty + mfeBonus + exitBonus + maePenalty;
  
  // Clamp to [-1, 1]
  return Math.max(-1, Math.min(1, totalReward));
}

// In settlePendingLearn():
// Track MFE/MAE during trade lifetime, then:
const outcome: EnhancedTradeOutcome = {
  realizedReturn: directionalReturn,
  maxFavorableExcursion: trackedMFE,
  maxAdverseExcursion: trackedMAE,
  holdingTimeBars: barsHeld,
  exitType: determineExitType(position),
};

const reward = calculateEnhancedReward(outcome);
paramAI.learn(pending.state, pending.actionIndex, reward, formatRegimeKey(features));
```

---

## Configuration Examples

### Conservative Configuration
```typescript
const CONSERVATIVE_CONFIG = {
  dailyTargetPct: 0.01,         // 1% daily
  weeklyTargetPct: 0.04,        // 4% weekly
  targetAchievedAction: 'STOP_TRADING' as const,
  riskReductionFactor: 0.25,
  cooldownAfterTargetMs: 7200000, // 2 hours
};

const CONSERVATIVE_TRAILING = {
  activationThresholdPct: 0.015,
  trailingDistancePct: 0.01,
  breakevenTriggerPct: 0.008,
};
```

### Aggressive Configuration
```typescript
const AGGRESSIVE_CONFIG = {
  dailyTargetPct: 0.03,         // 3% daily
  weeklyTargetPct: 0.12,        // 12% weekly
  targetAchievedAction: 'TRAIL_STOPS' as const,
  riskReductionFactor: 0.75,
  cooldownAfterTargetMs: 1800000, // 30 minutes
};

const AGGRESSIVE_TRAILING = {
  activationThresholdPct: 0.025,
  trailingDistancePct: 0.02,
  breakevenTriggerPct: 0.015,
};
```

---

## Testing Checklist

### Unit Tests
- [ ] ProfitGoalManager tracks PnL correctly
- [ ] Risk multiplier applies after target achievement
- [ ] Cooldown period prevents trading
- [ ] TrailingStopManager moves stops correctly
- [ ] Breakeven trigger activates at correct threshold

### Integration Tests
- [ ] RiskEngine rejects signals when profit goal halted
- [ ] Position sizing respects risk multiplier
- [ ] Trailing stops update on price ticks
- [ ] Daily/weekly resets work correctly

### Paper Trading Validation (Minimum 30 Days)
- [ ] Track daily goal achievement rate (target: >60%)
- [ ] Measure profit factor improvement (target: >1.5)
- [ ] Verify max drawdown reduction (target: <15%)
- [ ] Confirm trailing stops capture more trend profit

---

## Monitoring & Alerts

### Key Metrics to Monitor
1. **Daily Goal Achievement Rate**: Should be 60-70%
2. **Average Risk Multiplier**: Should be <1.0 if targets hit regularly
3. **Trailing Stop Updates per Trade**: More = trending market captured
4. **Profit Locked by Trailing Stops**: Difference between TP and actual exit

### Alert Conditions
```typescript
// Add to your notification system:
if (profitGoalManager.getDailyProgressPercent() >= 100) {
  telegramNotifier.send('🎯 Daily profit target achieved! Risk reduced.');
}

if (account.drawdown > 0.08) {
  telegramNotifier.send('⚠️ Warning: 8% drawdown - consider reducing size.');
}

const trailingStats = trailingStopManager.getStats();
if (trailingStats.avgProfitLocked > 0.03) {
  telegramNotifier.send(`📈 Trailing stops locked ${trailingStats.avgProfitLocked.toFixed(2)}% avg profit today`);
}
```

---

## Troubleshooting

### Problem: Trading stops completely after first target
**Solution:** Check `targetAchievedAction` config. Use `REDUCE_RISK` instead of `STOP_TRADING` for continuous operation.

### Problem: Trailing stops triggering too early
**Solution:** Increase `activationThresholdPct` or `trailingDistancePct`. Start with 2.5% activation, 2% trail.

### Problem: Risk multiplier not applying
**Solution:** Verify `ProfitGoalManager` is passed to `RiskEngine` constructor and `updatePnL()` is called on trade close.

### Problem: Daily PnL not resetting
**Solution:** Ensure scheduler job runs at correct timezone (UTC for crypto). Check `resetDaily()` is called with current equity.

---

## Next Steps After Implementation

1. **Week 1-2:** Run in paper mode, monitor goal achievement rates
2. **Week 3:** Tune parameters based on observed behavior
3. **Week 4:** Add strategy performance attribution
4. **Month 2:** Implement correlation monitoring
5. **Month 3:** Consider small live deployment with reduced size

---

## Support & Documentation

- Full API documentation: See inline JSDoc comments in source files
- Architecture overview: `/workspace/STAFF_ENGINEER_PROFITABILITY_REVIEW.md`
- Original system docs: `/workspace/README.md`, `/workspace/ADAPTIVE_SUPERTREND.md`
