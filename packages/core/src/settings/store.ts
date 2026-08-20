/**
 * Site settings store — in-memory for Phase 1, backed by the database in Phase 2+.
 *
 * Settings are scoped per site to support future multisite without redesign.
 */

export interface Setting {
  siteId: string;
  key: string;
  value: unknown;
  updatedAt: Date;
}

export class SettingsStore {
  private readonly store = new Map<string, Map<string, Setting>>();

  private siteMap(siteId: string): Map<string, Setting> {
    let map = this.store.get(siteId);
    if (!map) {
      map = new Map();
      this.store.set(siteId, map);
    }
    return map;
  }

  async get<T = unknown>(siteId: string, key: string): Promise<T | undefined> {
    return this.siteMap(siteId).get(key)?.value as T | undefined;
  }

  async set<T = unknown>(siteId: string, key: string, value: T): Promise<void> {
    this.siteMap(siteId).set(key, { siteId, key, value, updatedAt: new Date() });
  }

  async delete(siteId: string, key: string): Promise<void> {
    this.siteMap(siteId).delete(key);
  }

  async getAll(siteId: string): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.siteMap(siteId)) {
      result[k] = v.value;
    }
    return result;
  }
}
