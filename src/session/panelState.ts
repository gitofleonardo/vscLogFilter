export const LOG_FILTER_PANEL_VIEW_TYPE = 'logFilter.panel';

export interface LogFilterPanelState {
  sourceUri: string;
  sourceViewColumn: number;
  query: string;
  /** Extra search-scope URIs (primary is always sourceUri). */
  selectedUris?: string[];
}
