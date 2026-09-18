import { neon } from '@neondatabase/serverless';
import type { Store, StoreSnapshot } from './store.js';

export class NeonMetadata {
  private readonly sql;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async restore(key: string, store: Store): Promise<boolean> {
    const rows = await this.sql`SELECT value FROM telecloud_metadata WHERE key = ${key}` as { value: StoreSnapshot }[];
    const snapshot = rows[0]?.value;
    if (!snapshot) return false;
    store.importSnapshot(snapshot);
    return true;
  }

  async save(key: string, store: Store): Promise<void> {
    const snapshot = store.snapshot();
    await this.sql`
      INSERT INTO telecloud_metadata (key, value, updated_at)
      VALUES (${key}, ${JSON.stringify(snapshot)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now()
    `;
  }
}
