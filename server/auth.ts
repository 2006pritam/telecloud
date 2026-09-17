import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export type BrowserSession = {
  id: string;
  userId: string | null;
  siteAccess: number;
  expiresAt: number;
};

export type VaultSession = BrowserSession & { vaultUnlocked?: boolean };

/** Opaque, revocable browser sessions. Telegram credentials never enter a cookie. */
export class BrowserSessions {
  private db: DatabaseSync;

  constructor(dataDir: string, private secret: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'sessions.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY, userId TEXT, siteAccess INTEGER NOT NULL, expiresAt INTEGER NOT NULL
      );`);
    this.prune();
  }

  private digest(token: string) {
    // The random token supplies 256 bits of entropy even without SESSION_SECRET.
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  get(token: string | undefined): BrowserSession | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = this.db.prepare('SELECT * FROM browser_sessions WHERE id=? AND expiresAt>?')
      .get(this.digest(token), Date.now()) as BrowserSession | undefined;
    return session ?? null;
  }

  create(userId: string | null, siteAccess: boolean, ttl = SESSION_TTL) {
    this.prune();
    const token = randomBytes(32).toString('base64url');
    const session: BrowserSession = {
      id: this.digest(token), userId, siteAccess: Number(siteAccess), expiresAt: Date.now() + ttl,
    };
    this.db.prepare('INSERT INTO browser_sessions(id,userId,siteAccess,expiresAt) VALUES (?,?,?,?)')
      .run(session.id, session.userId, session.siteAccess, session.expiresAt);
    return { token, session };
  }

  revoke(id: string) { this.db.prepare('DELETE FROM browser_sessions WHERE id=?').run(id); }
  revokeUser(userId: string) { this.db.prepare('DELETE FROM browser_sessions WHERE userId=?').run(userId); }
  private prune() { this.db.prepare('DELETE FROM browser_sessions WHERE expiresAt<=?').run(Date.now()); }
  close() { this.db.close(); }
}
