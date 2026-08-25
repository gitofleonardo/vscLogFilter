import { describe, expect, it } from 'vitest';
import { inFlightFilterPercent, shouldEmitFilterProgress } from '../src/worker/filterProgress';

describe('inFlightFilterPercent', () => {
  it('returns 0 for empty totals or no progress', () => {
    expect(inFlightFilterPercent(0, 100)).toBe(0);
    expect(inFlightFilterPercent(10, 0)).toBe(0);
    expect(inFlightFilterPercent(-1, 10)).toBe(0);
  });

  it('scales processed/total and caps at 99 until complete', () => {
    expect(inFlightFilterPercent(50, 100)).toBe(50);
    expect(inFlightFilterPercent(1, 1000)).toBe(1);
    expect(inFlightFilterPercent(100, 100)).toBe(99);
  });
});

describe('shouldEmitFilterProgress', () => {
  it('only considers emitting on check boundaries', () => {
    expect(shouldEmitFilterProgress(0, 1000, 0, 4096, 100)).toBe(false);
    expect(shouldEmitFilterProgress(4095, 1000, 0, 4096, 100)).toBe(true);
  });

  it('suppresses emits inside the interval', () => {
    expect(shouldEmitFilterProgress(4095, 150, 100, 4096, 100)).toBe(false);
    expect(shouldEmitFilterProgress(4095, 200, 100, 4096, 100)).toBe(true);
  });
});
