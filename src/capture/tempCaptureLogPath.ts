/** Temp live-capture logs live under mkdtemp `vscLogFilter-*` dirs. */
export function isVscLogFilterTempCaptureLogFsPath(fsPath: string): boolean {
  return /[/\\]vscLogFilter-[^/\\]+[/\\]capture\.log$/i.test(fsPath);
}

export function isVscLogFilterTempCaptureLogUri(uriString: string): boolean {
  if (!uriString.startsWith('file:')) {
    return false;
  }
  try {
    const u = new URL(uriString);
    let path = decodeURIComponent(u.pathname);
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1);
    }
    return isVscLogFilterTempCaptureLogFsPath(path);
  } catch {
    return false;
  }
}
