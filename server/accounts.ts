import { existsSync } from 'node:fs';
import path from 'node:path';
import { Store } from './store.js';
import { TelegramStorage, sendCode, signIn, checkPassword, type Session } from './telegram.js';
import { NeonMetadata } from './neon.js';

export type StorageClient = Pick<TelegramStorage, 'verify' | 'upload' | 'download' | 'renameFile' | 'deleteFile' | 'close'>;
export type TelegramBackend = {
  sendCode: typeof sendCode;
  signIn: typeof signIn;
  checkPassword: typeof checkPassword;
  createStorage: (apiId: number, apiHash: string, session: Session) => StorageClient;
};

export const telegramBackend: TelegramBackend = {
  sendCode, signIn, checkPassword,
  createStorage: (apiId, apiHash, session) => new TelegramStorage(apiId, apiHash, session),
};

export type Workspace = {
  store: Store;
  storage: StorageClient | null;
  telegram: { account: string; channel: string } | null;
  persist?: () => Promise<void>;
};

/** An account owns its database and connection, independently of browser sessions. */
export class Accounts {
  private accounts = new Map<string, Workspace>();
  private legacyUser: string | null = null;

  constructor(private dataDir: string, private apiId: number, private apiHash: string, private backend: TelegramBackend, private neon?: NeonMetadata) {
    // Keep existing installations intact. Only the verified original owner can
    // open the old database; every other account gets its own directory.
    if (existsSync(path.join(dataDir, 'telegram', 'telecloud.sqlite'))) {
      const legacy = new Store(dataDir, 'telegram');
      try {
        this.legacyUser = legacy.accountId() ?? legacy.loadSession<Session>()?.userId ?? null;
      } finally {
        legacy.close();
      }
    }
  }

  get(userId: string): Workspace {
    if (!/^[1-9][0-9]{0,19}$/.test(userId)) throw new Error('Invalid Telegram account ID.');
    const cached = this.accounts.get(userId);
    if (cached) return cached;
    const store = new Store(userId === this.legacyUser ? this.dataDir : path.join(this.dataDir, 'users', userId), 'telegram');
    store.bindAccount(userId);
    const saved = store.loadSession<Session>();
    const valid = saved?.userId === userId && saved.session && saved.channelId && saved.accessHash;
    const account: Workspace = {
      store,
      storage: valid ? this.backend.createStorage(this.apiId, this.apiHash, saved) : null,
      telegram: valid ? { account: saved.name, channel: 'Telecloud Storage' } : null,
    };
    account.persist = this.neon ? () => this.neon!.save(`account:${userId}`, store) : undefined;
    this.accounts.set(userId, account);
    return account;
  }

  async activate(session: Session): Promise<Workspace> {
    const next = this.backend.createStorage(this.apiId, this.apiHash, session);
    try {
      const info = await next.verify();
      const account = this.get(session.userId);
      if (this.neon) await this.neon.restore(`account:${session.userId}`, account.store);
      account.store.bindChannel(session.channelId);
      account.store.saveSession(session);
      await account.persist?.();
      const previous = account.storage;
      account.storage = next;
      account.telegram = info;
      await previous?.close();
      return account;
    } catch (error) {
      await next.close();
      throw error;
    }
  }

  async unlink(userId: string) {
    const account = this.get(userId);
    const storage = account.storage;
    account.store.clearSession();
    account.storage = null;
    account.telegram = null;
    await storage?.close();
  }

  async close() {
    await Promise.all([...this.accounts.values()].map(async ({ store, storage }) => {
      await storage?.close();
      store.close();
    }));
    this.accounts.clear();
  }
}
