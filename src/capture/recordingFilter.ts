import type { LogFilterPanelState } from '../session/panelState';

export type SessionKind = NonNullable<LogFilterPanelState['sessionKind']>;

/** Internal worker query: match every indexed entry (live capture preview while recording). */
export const MATCH_ALL_FILTER_QUERY = '\0__LOG_FILTER_MATCH_ALL__';

export function shouldDeferQueryFilter(sessionKind: SessionKind, recording: boolean): boolean {
  return sessionKind === 'liveCapture' && recording;
}
