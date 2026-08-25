// src/broker/core/type-parity.check.ts
//
// PERMANENT regression gate — keep this file forever.
// Every line is a compile-time assertion that the live and backtest
// type systems remain assignable to the canonical model.
// A line that fails to compile = one divergence to resolve.
//
// Run: pnpm build  → the error list IS the Stage 0 inventory.

import type { OrderStatus as LiveOrderStatus, OrderSide as LiveOrderSide } from '../types.js';
import type { PaperOrderStatus, PaperOrderType } from '../paper/types.js';
import type {
  OrderStatus,
  OrderSide,
  OrderType,
  PositionStatus,
  FillRole,
} from './types.js';

// ── Direction 1: LIVE → CANONICAL (should pass) ──────────────
export const _liveStatus: OrderStatus = 'CANCELED' as LiveOrderStatus;
export const _livePartial: OrderStatus = 'PARTIALLY_FILLED' as LiveOrderStatus;
export const _liveFilled: OrderStatus = 'FILLED' as LiveOrderStatus;
export const _liveNew: OrderStatus = 'NEW' as LiveOrderStatus;
export const _liveSideBuy: OrderSide = 'BUY' as LiveOrderSide;
export const _liveSideSell: OrderSide = 'SELL' as LiveOrderSide;

// ── Direction 2: BACKTEST → CANONICAL ──
export const _smcPartial: OrderStatus = 'PARTIALLY_FILLED' as PaperOrderStatus;
export const _smcFilled: OrderStatus = 'FILLED' as PaperOrderStatus;
export const _smcNew: OrderStatus = 'NEW' as PaperOrderStatus;
export const _smcTypeLimit: OrderType = 'LIMIT' as PaperOrderType;
export const _smcTypeStop: OrderType = 'STOP' as PaperOrderType;
export const _smcTypeTp: OrderType = 'TAKE_PROFIT' as PaperOrderType;

export const _posOpen: PositionStatus = 'OPEN';
export const _posClosed: PositionStatus = 'CLOSED';
export const _posLiq: PositionStatus = 'LIQUIDATED';

export const _roleMaker: FillRole = 'maker';
export const _roleTaker: FillRole = 'taker';
