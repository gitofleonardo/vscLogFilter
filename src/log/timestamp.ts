const THREADTIME_TS = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;

export function parseThreadtimeTimestamp(ts: string, baseYear: number): number | undefined {
  const m = THREADTIME_TS.exec(ts);
  if (!m) {
    return undefined;
  }
  const [mm, dd, hh, mi, ss, ms] = parseParts(m[1]);
  if (mm === undefined) {
    return undefined;
  }
  const date = new Date(baseYear, mm - 1, dd, hh, mi, ss, ms);
  return date.getTime();
}

function parseParts(ts: string): number[] {
  const match = /^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(ts);
  if (!match) {
    return [];
  }
  return match.slice(1).map((x) => parseInt(x, 10));
}

export function inferBaseYear(timestamps: string[], fileMtimeMs: number): number {
  const baseYear = new Date(fileMtimeMs).getFullYear();
  if (timestamps.length < 2) {
    return baseYear;
  }
  let year = baseYear;
  let prevMonth = -1;
  for (const ts of timestamps) {
    const parts = parseParts(ts);
    if (parts.length === 0) {
      continue;
    }
    const month = parts[0];
    if (prevMonth === 12 && month === 1) {
      year += 1;
    }
    prevMonth = month;
  }
  return year;
}

export function parseTimeQuery(
  value: string,
  baseYear: number,
  refTimeMs?: number,
): number | undefined {
  const trimmed = value.trim();
  if (/^\d{2}-\d{2}/.test(trimmed)) {
    const normalized = trimmed.replace(/\\ /g, ' ');
    const ts = normalized.length >= 18 ? normalized.slice(0, 18) : `${normalized}.000`.slice(0, 18);
    return parseThreadtimeTimestamp(ts, baseYear);
  }
  if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) {
    const ref = refTimeMs !== undefined ? new Date(refTimeMs) : new Date(baseYear, 0, 1);
    const normalized = trimmed.length <= 8 ? `${trimmed}.000` : trimmed;
    const timePart = normalized.slice(0, 12).padEnd(12, '0');
    const fake = `${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')} ${timePart}`;
    return parseThreadtimeTimestamp(fake, ref.getFullYear());
  }
  return undefined;
}

export function parseAgeDuration(text: string): number | undefined {
  const m = /^(\d+)([smhd])$/.exec(text.trim());
  if (!m) {
    return undefined;
  }
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * (multipliers[unit] ?? 0);
}
