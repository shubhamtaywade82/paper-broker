import { describe, it, expect } from 'vitest';
import { SignalLoopDetector } from '../../src/strategy/SignalLoopDetector.js';

const KEY = 'autonomous-agent:SOLUSDT:OPEN_LONG';
const DUPLICATE = 'duplicate: long position already open';

describe('SignalLoopDetector', () => {
  it('allows submissions below the repeat threshold', () => {
    const detector = new SignalLoopDetector(5, 600_000);
    for (let i = 0; i < 4; i++) {
      expect(detector.isLooping(KEY, 1000 + i)).toBe(false);
      detector.record(KEY, DUPLICATE, 1000 + i);
    }
    expect(detector.isLooping(KEY, 1004)).toBe(false);
  });

  it('suppresses once the same rejection repeats to the threshold', () => {
    const detector = new SignalLoopDetector(5, 600_000);
    for (let i = 0; i < 5; i++) detector.record(KEY, DUPLICATE, 1000 + i);

    expect(detector.isLooping(KEY, 1005)).toBe(true);
    expect(detector.reasonFor(KEY, 1005)).toContain('rejected 5x');
    expect(detector.reasonFor(KEY, 1005)).toContain(DUPLICATE);
  });

  // This is a throttle, never a latch. A suppression that cannot lift by
  // itself is exactly how the circuit breaker bricked the agent for 2239
  // cycles — so the release path gets its own test, not just an option.
  it('releases by itself once the streak ages out', () => {
    const detector = new SignalLoopDetector(5, 600_000);
    for (let i = 0; i < 5; i++) detector.record(KEY, DUPLICATE, 1000 + i);
    expect(detector.isLooping(KEY, 1005)).toBe(true);

    // One millisecond before the window closes it is still suppressed.
    expect(detector.isLooping(KEY, 1004 + 599_999)).toBe(true);
    // At the window it lifts, and stays lifted.
    expect(detector.isLooping(KEY, 1004 + 600_000)).toBe(false);
    expect(detector.reasonFor(KEY, 1004 + 600_001)).toBeUndefined();
  });

  it('a success clears the streak immediately', () => {
    const detector = new SignalLoopDetector(5, 600_000);
    for (let i = 0; i < 5; i++) detector.record(KEY, DUPLICATE, 1000 + i);
    expect(detector.isLooping(KEY, 1005)).toBe(true);

    detector.record(KEY, null, 1006);
    expect(detector.isLooping(KEY, 1007)).toBe(false);
  });

  it('a different rejection reason restarts the count', () => {
    const detector = new SignalLoopDetector(5, 600_000);
    for (let i = 0; i < 4; i++) detector.record(KEY, DUPLICATE, 1000 + i);
    detector.record(KEY, 'INSUFFICIENT_AVAILABLE_BALANCE', 1004);
    detector.record(KEY, DUPLICATE, 1005);

    expect(detector.isLooping(KEY, 1006)).toBe(false);
  });

  // Five symbols interleave inside one agent cycle. A single-slot detector
  // would reset on every symbol switch and never trip — the reason this is
  // keyed rather than holding one "last signature".
  it('counts each signature independently while symbols interleave', () => {
    const detector = new SignalLoopDetector(3, 600_000);
    const symbols = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT'];

    let t = 1000;
    for (let round = 0; round < 3; round++) {
      for (const symbol of symbols) {
        detector.record(`autonomous-agent:${symbol}:OPEN_LONG`, DUPLICATE, t++);
      }
    }

    for (const symbol of symbols) {
      expect(detector.isLooping(`autonomous-agent:${symbol}:OPEN_LONG`, t)).toBe(true);
    }
  });

  it('a streak older than the window starts counting again from one', () => {
    const detector = new SignalLoopDetector(2, 10_000);
    detector.record(KEY, DUPLICATE, 1000);
    detector.record(KEY, DUPLICATE, 1000 + 10_000);

    expect(detector.isLooping(KEY, 1000 + 10_001)).toBe(false);
  });

  it('reset drops every tracked streak', () => {
    const detector = new SignalLoopDetector(2, 600_000);
    detector.record(KEY, DUPLICATE, 1000);
    detector.record(KEY, DUPLICATE, 1001);
    expect(detector.isLooping(KEY, 1002)).toBe(true);

    detector.reset();
    expect(detector.isLooping(KEY, 1003)).toBe(false);
  });
});

describe('SignalLoopDetector memory', () => {
  // Keying by signature is what makes the detector work across interleaved
  // symbols, but scale-in keys embed position identity (`scale-in:<posKey>:<n>`)
  // and so have unbounded cardinality over a long-running process. A key that
  // is rejected once and never submitted again must not be retained forever.
  it('drops streaks that have aged out instead of retaining them', () => {
    const detector = new SignalLoopDetector(5, 10_000);

    for (let i = 0; i < 500; i++) {
      detector.record(`scale-in:POS:${i}:1`, 'duplicate: long position already open', 1000 + i);
    }
    expect(detector.size).toBe(500);

    // One later write past the window sweeps every stale entry.
    detector.record('scale-in:POS:new:1', 'duplicate: long position already open', 1000 + 500 + 10_000);
    expect(detector.size).toBe(1);
  });
});
