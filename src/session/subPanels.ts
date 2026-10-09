import { DEFAULT_SUB_PANEL_ID } from '../constants';

export { DEFAULT_SUB_PANEL_ID };

export interface SubPanelState {
  id: string;
  query: string;
  title?: string;
}

export interface SubPanelRuntime extends SubPanelState {
  matchedCount: number;
  filterGeneration: number;
  maxLineNumber: number;
}

export function createSubPanel(id: string, query = '', title?: string): SubPanelRuntime {
  return {
    id,
    query,
    title,
    matchedCount: 0,
    filterGeneration: 0,
    maxLineNumber: 1,
  };
}

export function newSubPanelId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function tabLabel(panel: SubPanelState, index: number): string {
  if (panel.title?.trim()) {
    return panel.title.trim();
  }
  const q = panel.query.trim();
  if (q) {
    return q.length > 28 ? `${q.slice(0, 28)}…` : q;
  }
  return `Filter ${index + 1}`;
}

/** Restore from persisted state or legacy single query. */
export function initialSubPanels(
  legacyQuery: string,
  persisted?: SubPanelState[],
  activeId?: string,
): { panels: SubPanelRuntime[]; activeSubPanelId: string } {
  if (Array.isArray(persisted) && persisted.length > 0) {
    const panels = persisted.map((p) =>
      createSubPanel(String(p.id || DEFAULT_SUB_PANEL_ID), String(p.query ?? ''), p.title),
    );
    const active =
      activeId && panels.some((p) => p.id === activeId) ? activeId : panels[0].id;
    return { panels, activeSubPanelId: active };
  }
  return {
    panels: [createSubPanel(DEFAULT_SUB_PANEL_ID, legacyQuery)],
    activeSubPanelId: DEFAULT_SUB_PANEL_ID,
  };
}

export function toPersistedSubPanels(panels: SubPanelRuntime[]): SubPanelState[] {
  return panels.map((p) => ({
    id: p.id,
    query: p.query,
    title: p.title,
  }));
}
