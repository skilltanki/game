// Persists built grids in IndexedDB so a map reflects once per device, not
// once per battle (the biggest maps take seconds on a phone). The key folds
// the map, the geometry fingerprint the battle hands over, the nav params
// and the algorithm version, so any change rebuilds.
import { deserializeNavGrid, serializeNavGrid, type NavGrid, type NavGridRecord } from '../../../../classes/engine/NavGrid';
import type { NavParams } from '../../../../model/engine/Nav';

/** Bump whenever the grid/graph algorithms change what they store. */
export const NAV_CACHE_VERSION = 9;
const DB_NAME = 'skilltanki-nav';
const STORE = 'grids';

export class NavCacheService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  public key = (mapId: string, fingerprint: string, params: NavParams): string =>
    `${mapId}|${fingerprint}|v${NAV_CACHE_VERSION}|${JSON.stringify(params)}`;

  public load = async (key: string): Promise<NavGrid | null> => {
    const db = await this.open();
    if (db == null) return null;
    try {
      const record = await request<NavGridRecord | undefined>(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
      return record == null ? null : deserializeNavGrid(record);
    } catch {
      return null;
    }
  };

  public store = async (key: string, grid: NavGrid): Promise<void> => {
    const db = await this.open();
    if (db == null) return;
    try {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(serializeNavGrid(grid), key));
    } catch {
      // Quota or private mode: the grid simply gets rebuilt next time.
    }
  };

  public clear = async (): Promise<void> => {
    const db = await this.open();
    if (db == null) return;
    try {
      await request(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
    } catch {
      // nothing to clear
    }
  };

  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise == null) {
      this.dbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE);
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export default NavCacheService;
