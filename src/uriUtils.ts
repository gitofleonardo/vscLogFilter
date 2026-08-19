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
