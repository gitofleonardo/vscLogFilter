/** Merge persisted/user order with currently open tabs (new tabs append, closed tabs drop). */
export function mergeFileOrder(
  existingOrder: string[],
  openUris: string[],
  primary: string,
): string[] {
  const openSet = new Set(openUris);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const u of existingOrder) {
    if (openSet.has(u) && !seen.has(u)) {
      seen.add(u);
      result.push(u);
    }
  }

  if (primary && openSet.has(primary) && !seen.has(primary)) {
    seen.add(primary);
    result.push(primary);
  }

  for (const u of openUris) {
    if (!seen.has(u)) {
      seen.add(u);
      result.push(u);
    }
  }

  return result;
}

/** Selected URIs in fileOrder sequence; primary is always included when still open. */
export function selectedUrisInFileOrder(
  fileOrder: string[],
  selectedCandidates: string[],
  primary: string,
  openSet: Set<string>,
): string[] {
  const selectedSet = new Set(selectedCandidates);
  selectedSet.add(primary);
  return fileOrder.filter((u) => selectedSet.has(u) && openSet.has(u));
}

/** Extra selected URIs from persisted state (excludes primary). */
export function normalizePreferredSelected(primary: string, uris: unknown): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(uris)) {
    return next;
  }
  for (const u of uris) {
    if (typeof u === 'string' && u && u !== primary && !seen.has(u)) {
      seen.add(u);
      next.push(u);
    }
  }
  return next;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
