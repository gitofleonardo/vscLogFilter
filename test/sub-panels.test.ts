import { describe, expect, it } from 'vitest';
import {
  createSubPanel,
  initialSubPanels,
  tabLabel,
  toPersistedSubPanels,
} from '../src/session/subPanels';

describe('initialSubPanels', () => {
  it('creates default panel from legacy query', () => {
    const { panels, activeSubPanelId } = initialSubPanels('tag=:Foo');
    expect(panels).toHaveLength(1);
    expect(panels[0].query).toBe('tag=:Foo');
    expect(activeSubPanelId).toBe(panels[0].id);
  });

  it('restores persisted panels and active id', () => {
    const { panels, activeSubPanelId } = initialSubPanels('', [
      { id: 'a', query: 'q1' },
      { id: 'b', query: 'q2' },
    ], 'b');
    expect(panels.map((p) => p.id)).toEqual(['a', 'b']);
    expect(activeSubPanelId).toBe('b');
    expect(panels[1].query).toBe('q2');
  });

  it('falls back to first panel when active id is missing', () => {
    const { activeSubPanelId } = initialSubPanels('', [{ id: 'x', query: '' }], 'gone');
    expect(activeSubPanelId).toBe('x');
  });
});

describe('tabLabel', () => {
  it('truncates long queries', () => {
    const long = 'x'.repeat(40);
    const label = tabLabel(createSubPanel('id', long), 0);
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(29);
  });

  it('uses Filter N when query is empty', () => {
    expect(tabLabel(createSubPanel('id', ''), 2)).toBe('Filter 3');
  });
});

describe('toPersistedSubPanels', () => {
  it('strips runtime fields', () => {
    const panels = [
      { ...createSubPanel('a', 'q1'), matchedCount: 5, filterGeneration: 2, maxLineNumber: 10 },
    ];
    expect(toPersistedSubPanels(panels)).toEqual([{ id: 'a', query: 'q1', title: undefined }]);
  });
});
