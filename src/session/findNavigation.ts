export type FindMatch = { rowIndex: number; start: number; end: number };
export type FindPos = { rowIndex: number; offset?: number; start?: number };

export function compareFindPos(a: FindPos, b: FindPos): number {
  if (a.rowIndex !== b.rowIndex) {
    return a.rowIndex - b.rowIndex;
  }
  const aOff = a.offset ?? a.start ?? 0;
  const bOff = b.offset ?? b.start ?? 0;
  return aOff - bOff;
}

export function findMatchIndexAtOrAfter(
  matches: FindMatch[],
  rowIndex: number,
  offset: number,
): number {
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.rowIndex > rowIndex || (m.rowIndex === rowIndex && m.start >= offset)) {
      return i;
    }
  }
  return -1;
}

export function findMatchIndexBefore(
  matches: FindMatch[],
  rowIndex: number,
  offset: number,
): number {
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m.rowIndex < rowIndex || (m.rowIndex === rowIndex && m.start < offset)) {
      return i;
    }
  }
  return -1;
}

export function resolveMatchFromAnchor(
  matches: FindMatch[],
  anchor: FindPos,
  direction: number,
): number {
  if (!matches.length) {
    return -1;
  }
  if (direction > 0) {
    const idx = findMatchIndexAtOrAfter(matches, anchor.rowIndex, anchor.offset ?? 0);
    return idx >= 0 ? idx : 0;
  }
  const idx = findMatchIndexBefore(matches, anchor.rowIndex, anchor.offset ?? 0);
  return idx >= 0 ? idx : matches.length - 1;
}

export function computeNextFindIndex(
  matches: FindMatch[],
  anchor: FindPos,
  current: FindMatch | null,
  selectedIndex: number,
  findNavSynced: boolean,
): number {
  let rowIndex: number;
  let offset: number;
  if (
    current &&
    selectedIndex === current.rowIndex &&
    (findNavSynced ||
      compareFindPos(anchor, { rowIndex: current.rowIndex, offset: current.start }) >= 0)
  ) {
    rowIndex = current.rowIndex;
    offset = current.end;
  } else {
    rowIndex = anchor.rowIndex;
    offset = anchor.offset ?? 0;
  }
  const idx = findMatchIndexAtOrAfter(matches, rowIndex, offset);
  return idx >= 0 ? idx : 0;
}

export function computePrevFindIndex(
  matches: FindMatch[],
  anchor: FindPos,
  current: FindMatch | null,
  selectedIndex: number,
  findNavSynced: boolean,
): number {
  let rowIndex: number;
  let offset: number;
  if (
    current &&
    selectedIndex === current.rowIndex &&
    (findNavSynced ||
      (current.rowIndex === anchor.rowIndex &&
        compareFindPos(anchor, { rowIndex: current.rowIndex, offset: current.start }) <= 0))
  ) {
    rowIndex = current.rowIndex;
    offset = current.start;
  } else {
    rowIndex = anchor.rowIndex;
    offset = anchor.offset ?? 0;
  }
  const idx = findMatchIndexBefore(matches, rowIndex, offset);
  return idx >= 0 ? idx : matches.length - 1;
}
