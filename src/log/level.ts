const LEVEL_ORDER: Record<string, number> = {
  V: 0,
  VERBOSE: 0,
  D: 1,
  DEBUG: 1,
  I: 2,
  INFO: 2,
  W: 3,
  WARN: 3,
  WARNING: 3,
  E: 4,
  ERROR: 4,
  F: 5,
  FATAL: 5,
  A: 6,
  ASSERT: 6,
};

export function normalizeLevel(level: string | undefined): number {
  if (!level) {
    return -1;
  }
  const u = level.toUpperCase();
  return LEVEL_ORDER[u] ?? LEVEL_ORDER[u[0]] ?? -1;
}

export function parseLevelQuery(query: string): number {
  return normalizeLevel(query);
}

export function levelMeetsMinimum(entryLevel: string | undefined, minLevel: string): boolean {
  const entry = normalizeLevel(entryLevel);
  const min = parseLevelQuery(minLevel);
  if (entry < 0 || min < 0) {
    return false;
  }
  return entry >= min;
}

export function levelEquals(entryLevel: string | undefined, exact: string): boolean {
  return normalizeLevel(entryLevel) === parseLevelQuery(exact);
}
