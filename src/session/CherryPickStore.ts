import {
  cherryPickKey,
  type CherryPickItem,
} from './cherryPickTypes';

export class CherryPickStore {
  private readonly buckets = new Map<string, Map<string, CherryPickItem>>();

  private itemsFor(subPanelId: string): Map<string, CherryPickItem> {
    let bucket = this.buckets.get(subPanelId);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(subPanelId, bucket);
    }
    return bucket;
  }

  add(item: CherryPickItem, subPanelId: string): boolean {
    const items = this.itemsFor(subPanelId);
    if (items.has(item.key)) {
      return false;
    }
    items.set(item.key, item);
    return true;
  }

  remove(key: string, subPanelId: string): boolean {
    return this.itemsFor(subPanelId).delete(key);
  }

  removeMany(keys: string[], subPanelId: string): number {
    const items = this.itemsFor(subPanelId);
    let removed = 0;
    for (const key of keys) {
      if (items.delete(key)) {
        removed++;
      }
    }
    return removed;
  }

  clearSubPanel(subPanelId: string): void {
    this.buckets.delete(subPanelId);
  }

  clear(): void {
    this.buckets.clear();
  }

  has(key: string, subPanelId: string): boolean {
    return this.itemsFor(subPanelId).has(key);
  }

  count(subPanelId: string): number {
    return this.itemsFor(subPanelId).size;
  }

  pickedKeys(subPanelId: string): string[] {
    return [...this.itemsFor(subPanelId).keys()];
  }

  listSorted(subPanelId: string): CherryPickItem[] {
    return [...this.itemsFor(subPanelId).values()].sort((a, b) => {
      const uriCmp = a.sourceUri.localeCompare(b.sourceUri);
      if (uriCmp !== 0) {
        return uriCmp;
      }
      return a.lineNumber - b.lineNumber;
    });
  }

  keyFor(sourceUri: string, lineNumber: number): string {
    return cherryPickKey(sourceUri, lineNumber);
  }
}
