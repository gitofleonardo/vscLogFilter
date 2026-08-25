import { FILTER_PROGRESS_CHECK_EVERY, FILTER_PROGRESS_INTERVAL_MS } from '../constants';

/** Percent shown while a filter is still running (never 100 until results land). */
export function inFlightFilterPercent(processed: number, total: number): number {
  if (total <= 0 || processed <= 0) {
    return 0;
  }
  if (processed >= total) {
    return 99;
  }
  return Math.max(1, Math.min(99, Math.round((processed / total) * 100)));
}

export function shouldEmitFilterProgress(
  index: number,
  nowMs: number,
  lastEmitMs: number,
  checkEvery = FILTER_PROGRESS_CHECK_EVERY,
  intervalMs = FILTER_PROGRESS_INTERVAL_MS,
): boolean {
  if (checkEvery <= 0 || (index + 1) % checkEvery !== 0) {
    return false;
  }
  return nowMs - lastEmitMs >= intervalMs;
}
