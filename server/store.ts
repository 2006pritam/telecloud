import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type Entry = {
  id: string; name: string; kind: 'file' | 'folder'; parent_id: string | null;
  mime: string; size: number; color: string; starred: number;
  vault: number;
  message_id: number | null; local_path: string | null;
  created_at: string; updated_at: string; deleted_at: string | null; trash_root: string | null;
};

export class Store {
  db: DatabaseSync;
  dir: string;
  constructor(dataDir: string, mode: 'demo' | 'telegram') {
    this.dir = path.resolve(dataDir, mode);
    mkdirSync(path.join(this.dir, 'files'), { recursive: true });
    this.db = new DatabaseSync(path.join(this.dir, 'telecloud.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT,
      mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT 'purple', starred INTEGER NOT NULL DEFAULT 0,
      vault INTEGER NOT NULL DEFAULT 0,
      message_id INTEGER, local_path TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, trash_root TEXT
    ); CREATE INDEX IF NOT EXISTS entries_parent ON entries(parent_id);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    try { this.db.exec('ALTER TABLE entries ADD COLUMN vault INTEGER NOT NULL DEFAULT 0'); } catch { /* existing schema already migrated */ }
  }
  close() { this.db.close(); }
  all(): Entry[] { return this.db.prepare('SELECT * FROM entries ORDER BY created_at DESC').all() as unknown as Entry[]; }
  get(id: string): Entry | undefined { return this.db.prepare('SELECT * FROM entries WHERE id=?').get(id) as Entry | undefined; }
  insert(input: Partial<Entry> & Pick<Entry, 'name' | 'kind'>): Entry {
    const now = new Date().toISOString();
    const entry: Entry = { id: randomUUID(), parent_id: null, mime: '', size: 0, color: 'purple', starred: 0, vault: 0,
      message_id: null, local_path: null, created_at: now,
      updated_at: now, deleted_at: null, trash_root: null, ...input };
    const keys = Object.keys(entry);
    this.db.prepare(`INSERT INTO entries (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(entry));
    return entry;
  }
  update(id: string, patch: Partial<Entry>) {
    const allowed = new Set(['name', 'parent_id', 'starred', 'message_id', 'deleted_at', 'trash_root', 'color']);
    const pairs = Object.entries(patch).filter(([key]) => allowed.has(key));
    pairs.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE entries SET ${pairs.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...pairs.map(([, value]) => value as string | number | null), id);
  }
  descendants(id: string): Entry[] {
    const all = this.all();
    const result: Entry[] = [];
    const walk = (parent: string) => { for (const e of all.filter(e => e.parent_id === parent)) { result.push(e); walk(e.id); } };
    walk(id); return result;
  }
  remove(id: string) {
    const entry = this.get(id);
    if (entry?.local_path) {
      const target = this.filePath(entry.local_path);
      if (existsSync(target)) unlinkSync(target);
    }
    this.db.prepare('DELETE FROM entries WHERE id=?').run(id);
  }
  filePath(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid stored file identifier.');
    return path.join(this.dir, 'files', id);
  }
  /** Accepts a stream so demo-mode uploads never buffer a whole file. */
  saveFile(id: string, data: Buffer | string | Readable) {
    const target = this.filePath(id);
    if (data instanceof Readable) {
      return new Promise<void>((resolve, reject) => {
        const out = createWriteStream(target);
        data.pipe(out);
        out.on('finish', () => resolve());
        out.on('error', reject);
        data.on('error', reject);
      });
    }
    writeFileSync(target, data);
  }
  publicEntry(e: Entry) {
    const { message_id: _message, local_path: _local, ...safe } = e;
    return { ...safe, starred: !!e.starred, vault: !!e.vault };
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  /**
   * The Telegram session string is full account access, so it is stored on the
   * server only, never returned by the API, and never sent to the browser.
   */
  saveSession(session: unknown) {
    this.db.prepare("INSERT INTO settings(key,value) VALUES ('telegram_session',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(session));
  }
  loadSession<T>(): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='telegram_session'").get() as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value) as T; } catch { return null; }
  }
  clearSession() {
    this.db.prepare("DELETE FROM settings WHERE key='telegram_session'").run();
  }
  /** Guards against pointing a populated DATA_DIR at a different account. */
  accountId(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='telegram_user'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  bindChannel(channelId: string) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='telegram_channel'").get() as { value: string } | undefined;
    const previous = row?.value ?? this.loadSession<{ channelId?: string }>()?.channelId;
    if (previous && previous !== channelId && this.all().some((entry) => entry.message_id)) {
      throw new Error('Your files belong to a different storage channel. Restore the original Telecloud Storage channel before signing in.');
    }
    this.db.prepare("INSERT INTO settings(key,value) VALUES ('telegram_channel',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(channelId);
  }

  bindAccount(userId: string) {
    const current = this.db.prepare("SELECT value FROM settings WHERE key='telegram_user'").get() as { value: string } | undefined;
    if (current && current.value !== userId) {
      throw new Error('This data directory belongs to a different Telegram account. Use a new DATA_DIR.');
    }
    this.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('telegram_user',?)").run(userId);
  }
  seed() {
    if (this.db.prepare("SELECT value FROM settings WHERE key='seeded'").get()) return;
    const folderNames = [['Brand assets', 'purple'], ['Website redesign', 'blue'], ['Photography', 'orange'], ['Documents', 'green']];
    const folders = folderNames.map(([name, color]) => this.insert({ name, color, kind: 'folder' }));
    const makeFile = (name: string, mime: string, data: string, options: Partial<Entry> = {}) => {
      const id = randomUUID(); this.saveFile(id, data);
      return this.insert({ id, name, kind: 'file', mime, size: Buffer.byteLength(data), local_path: id, ...options });
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#c9dcda"/><stop offset="1" stop-color="#e9e7d7"/></linearGradient><linearGradient id="land" x2="0" y2="1"><stop stop-color="#719291"/><stop offset="1" stop-color="#253f49"/></linearGradient></defs><rect width="1200" height="800" fill="url(#sky)"/><circle cx="830" cy="235" r="82" fill="#f9edc9" opacity=".85"/><path d="M0 550 190 210 390 520 570 120 820 520 1000 300 1200 600V800H0" fill="#a3b8b2"/><path d="m0 590 310-300 350 410 270-370 270 270v200H0" fill="#698b87"/><path d="M0 620 210 520 480 670 750 480 1200 670v130H0" fill="url(#land)"/><path d="M0 745Q300 690 610 748T1200 728v72H0" fill="#abc7c0"/><path d="m550 149 20-29 78 125-72-38-56 42z" fill="#f0f2e7" opacity=".8"/></svg>`;
    makeFile('Alpine escape.svg', 'image/svg+xml', svg, { starred: 1 });
    const brand = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#eae4fb"/><circle cx="900" cy="410" r="240" fill="#c7b7ee"/><circle cx="900" cy="410" r="160" fill="#9c84d7"/><circle cx="900" cy="410" r="80" fill="#7154b5"/><text x="90" y="145" font-family="Arial,sans-serif" font-size="22" letter-spacing="5" fill="#7455ad">THE EVERYDAY STUDIO</text><text x="90" y="345" font-family="Georgia,serif" font-size="94" fill="#352254">Made with</text><text x="90" y="450" font-family="Georgia,serif" font-size="94" font-style="italic" fill="#352254">a little care.</text><text x="90" y="690" font-family="Arial,sans-serif" font-size="22" fill="#7455ad">BRAND EXPLORATION — 2026</text></svg>`;
    makeFile('Brand exploration.svg', 'image/svg+xml', brand, { starred: 1 });
    const notes = '# A little space for everything\n\nWelcome to your Telecloud workspace.\n\n## Our next chapter\n- Keep things thoughtful, simple, and useful.\n- Make room for ideas before they become projects.\n- Put everything you need within easy reach.\n\n## This week\n1. Review the visual direction\n2. Share the first website concepts\n3. Organize our favorite references\n\nThese are sample files. You can rename, move, download, or delete them.\n';
    makeFile('Project notes.md', 'text/markdown', notes);
    makeFile('September budget.csv', 'text/csv', 'Category,Planned,Actual\nDesign,1200,1050\nDevelopment,2400,2200\nPhotography,600,450\nTools,150,120\n');
    makeFile('Brand guidelines.md', 'text/markdown', '# Brand guidelines\n\nOur voice is warm, clear, and considered.\n\nPrimary: Lavender #7860DD\nSecondary: Ink #282634\nBackground: Paper #F8F9FB\n', { parent_id: folders[0].id, starred: 1 });
    makeFile('Color palette.csv', 'text/csv', 'Color,Hex\nLavender,#7860DD\nInk,#282634\nPaper,#F8F9FB\nSage,#95B59F\n', { parent_id: folders[0].id });
    makeFile('Website brief.md', 'text/markdown', '# Website redesign\n\nA calm home for a growing collection of ideas.\n\n## Pages\n- Home\n- Selected work\n- About\n- Contact\n', { parent_id: folders[1].id });
    makeFile('Shot list.md', 'text/markdown', '# The great outdoors\n\n- Soft morning light\n- Mountains through the mist\n- A quiet lake\n- Details along the trail\n', { parent_id: folders[2].id });
    makeFile('Welcome to Telecloud.txt', 'text/plain', 'Welcome to Telecloud!\n\nThis workspace is running in local demo mode. Your uploads are saved on this computer.\n\nTo store files in Telegram, follow the setup guide in README.md and add your API ID and hash to .env, then link your account from inside the app.\n\nFolders are created in the app database. Your files are uploaded to a private channel in your own Telegram account.\n', { parent_id: folders[3].id });
    this.db.prepare("INSERT INTO settings(key,value) VALUES ('seeded','true')").run();
  }
}
