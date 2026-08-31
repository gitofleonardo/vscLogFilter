import {
  cherryPickKey,
  type CherryPickItem,
} from './cherryPickTypes';

export class CherryPickStore {
  private readonly items = new Map<string, CherryPickItem>();

  add(item: CherryPickItem): boolean {
    if (this.items.has(item.key)) {
      return false;
    }
    this.items.set(item.key, item);
    return true;
  }

  remove(key: string): boolean {
    return this.items.delete(key);
  }

  removeMany(keys: string[]): number {
    let removed = 0;
    for (const key of keys) {
      if (this.items.delete(key)) {
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.items.clear();
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  count(): number {
    return this.items.size;
  }

  pickedKeys(): string[] {
    return [...this.items.keys()];
  }

  listSorted(): CherryPickItem[] {
    return [...this.items.values()].sort((a, b) => {
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
