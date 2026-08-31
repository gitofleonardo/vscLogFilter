export interface UriLike {
  scheme: string;
  fsPath: string;
  toString(): string;
}

export function uriMatches(a: UriLike, b: UriLike): boolean {
  if (a.scheme !== b.scheme) {
    return false;
  }
  if (a.scheme === 'file') {
    return a.fsPath === b.fsPath;
  }
  return a.toString() === b.toString();
}

/** Basename from a vscode.Uri-like path (uses decoded fsPath when available). */
export function shortFileNameFromFsPath(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * Basename from a URI string (`file:///...` may be percent-encoded).
 * Prefer fsPath-based helpers in the extension host when a Uri object exists.
 */
export function shortFileNameFromUriString(uriString: string): string {
  const withoutQuery = uriString.split(/[?#]/, 1)[0];
  const slash = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'));
  const raw = slash >= 0 ? withoutQuery.slice(slash + 1) : withoutQuery;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const DISPLAY_HEAD = 6;
const DISPLAY_TAIL = 6;
const ELLIPSIS = '...';

/** Truncate long display names to first 6 + ... + last 6 when omitted middle > ellipsis length. */
export function truncateDisplayFileName(name: string): string {
  const s = String(name ?? '');
  const omitted = s.length - DISPLAY_HEAD - DISPLAY_TAIL;
  if (omitted <= ELLIPSIS.length) {
    return s;
  }
  return `${s.slice(0, DISPLAY_HEAD)}${ELLIPSIS}${s.slice(-DISPLAY_TAIL)}`;
}
