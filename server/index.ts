import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store, type Entry } from './store.js';
import { TelegramAuthError, MAX_FILE_BYTES, type QrLogin } from './telegram.js';
import { Accounts, telegramBackend, type TelegramBackend, type Workspace, type StorageClient } from './accounts.js';
import { BrowserSessions, SESSION_TTL, type BrowserSession } from './auth.js';
import { NeonMetadata } from './neon.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = process.env.DATA_DIR || './data';
// Containers give /tmp a small ephemeral layer, which a 2 GB upload can fill.
// Point this at the same volume as DATA_DIR when deploying.
const UPLOAD_DIR = process.env.UPLOAD_DIR || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const API_ID = process.env.TELEGRAM_API_ID?.trim() || '';
const API_HASH = process.env.TELEGRAM_API_HASH?.trim() || '';
const COOKIE = 'telecloud_session';
const DEMO_MAX_BYTES = 512 * 1024 * 1024;

/** The credentials the README uses as an illustration; nobody owns these. */
const EXAMPLE_API_HASH = '0123456789abcdef0123456789abcdef';
const CREDENTIALS_HELP =
  'Copy .env.example to .env and set TELEGRAM_API_ID and TELEGRAM_API_HASH from https://my.telegram.org → API development tools, then restart the server.';

export type TelegramSetup = {
  /** Parsed credentials, or 0/'' when they cannot be used. */
  apiId: number;
  apiHash: string;
  /** True when the app stores in Telegram rather than running the local demo. */
  configured: boolean;
  /**
   * Why Telegram storage is off, or what looks wrong about the credentials.
   * Null only when the pair is present and well formed.
   */
  hint: string | null;
};

/**
 * Parse the Telegram credentials and explain them.
 *
 * Missing, half-filled, or mistyped credentials used to drop the app into the
 * local demo with no visible reason: the demo looks exactly like a working
 * drive, so "Telegram is broken" and "Telegram was never switched on" are
 * indistinguishable from the browser. Every rejection here carries the reason.
 */
export function inspectTelegram(rawId: string | number, rawHash: string): TelegramSetup {
  const off = (hint: string): TelegramSetup => ({ apiId: 0, apiHash: '', configured: false, hint });
  const id = String(rawId ?? '').trim();
  const hash = rawHash.trim();

  if ((!id || id === '0') && !hash) return off(`Telegram storage is off: TELEGRAM_API_ID and TELEGRAM_API_HASH are not set. ${CREDENTIALS_HELP}`);
  if (!hash) return off('Telegram storage is off: TELEGRAM_API_ID is set but TELEGRAM_API_HASH is empty. Add the API hash shown beside the API ID on my.telegram.org.');
  if (!id || id === '0') return off('Telegram storage is off: TELEGRAM_API_HASH is set but TELEGRAM_API_ID is empty. Add the numeric API ID shown above the API hash on my.telegram.org.');
  if (!/^[1-9][0-9]*$/.test(id)) return off(`Telegram storage is off: TELEGRAM_API_ID must be the number from my.telegram.org, not “${id}”.`);
  if (hash.toLowerCase() === EXAMPLE_API_HASH) return off(`Telegram storage is off: .env still holds the example API hash. ${CREDENTIALS_HELP}`);

  const apiId = Number(id);
  // Not fatal — only Telegram can judge a credential pair — but a hash that is
  // not 32 hex characters is almost always a truncated or half-pasted copy, and
  // the sign-in failure it causes points at the phone number instead.
  const hint = /^[0-9a-f]{32}$/i.test(hash)
    ? null
    : 'TELEGRAM_API_HASH is not the 32-character hexadecimal hash that my.telegram.org issues, so Telegram is likely to reject the sign-in.';
  return { apiId, apiHash: hash, configured: true, hint };
}

const FOLDER_COLORS = ['purple', 'blue', 'green', 'orange', 'pink', 'amber'] as const;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const loginSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(256, 'That password is too long.'),
});

const folderSchema = z.object({
  name: z.string().trim().min(1, 'Give the folder a name.').max(120, 'Folder names are limited to 120 characters.'),
  color: z.enum(FOLDER_COLORS).optional(),
  parentId: z.string().nullable().optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty.').max(200, 'Names are limited to 200 characters.').optional(),
    color: z.enum(FOLDER_COLORS).optional(),
    starred: z.boolean().optional(),
    parentId: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update.' });

const phoneSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a phone number with its country code, like +15551234567.'),
});
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{4,7}$/, 'Login codes are 5 digits.') });
const twoFactorSchema = z.object({ password: z.string().min(1, 'Enter your two-step verification password.').max(256) });
const vaultPinSchema = z.object({ pin: z.string().regex(/^\d{6}$/, 'Vault PIN must be exactly 6 digits.') });

export type AppOptions = {
  dataDir?: string;
  password?: string;
  sessionSecret?: string;
  apiId?: number;
  apiHash?: string;
  telegramBackend?: TelegramBackend;
  secureCookies?: boolean;
  trustProxy?: number;
  /** Where in-flight uploads are staged. Defaults to a folder in the OS temp directory. */
  uploadDir?: string;
};

export type AppInfo = {
  app: express.Express;
  mode: 'demo' | 'telegram';
  setup: TelegramSetup;
  close: () => Promise<void>;
};

export async function createApp(options: AppOptions = {}): Promise<AppInfo> {
  const dataDir = options.dataDir ?? DATA_DIR;
  const password = options.password ?? APP_PASSWORD;
  const backend = options.telegramBackend ?? telegramBackend;
  const secret = options.sessionSecret || SESSION_SECRET || password;
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE === 'true';

  // With usable API credentials the app stores in Telegram; without them it
  // runs a self-contained local demo so the UI is explorable before linking.
  const setup = inspectTelegram(options.apiId ?? API_ID, options.apiHash ?? API_HASH);
  const { apiId, apiHash, configured } = setup;
  const mode: 'demo' | 'telegram' = configured ? 'telegram' : 'demo';
  const neon = process.env.DATABASE_URL ? new NeonMetadata(process.env.DATABASE_URL) : undefined;
  const sessions = new BrowserSessions(dataDir, secret);
  const accounts = new Accounts(dataDir, apiId, apiHash, backend, neon);
  const demo: Workspace | null = configured ? null : { store: new Store(dataDir, 'demo'), storage: null, telegram: null };
  demo?.store.seed();
  if (demo && neon) {
    await neon.restore('demo', demo.store);
    demo.persist = () => neon.save('demo', demo.store);
  }
  const requestWorkspaces = new WeakMap<Request, Workspace>();
  const unlockedVaults = new Set<string>();
  function workspace(req: Request): Workspace {
    const current = requestWorkspaces.get(req);
    if (!current) throw new HttpError(401, 'Sign in with Telegram to continue.');
    return current;
  }

  async function storeWorkspace(req: Request) {
    await workspace(req).persist?.();
  }

  // Uploads stream to a temp file rather than memory: a 2 GB buffer would
  // exhaust the heap, and GramJS uploads from a path anyway.
  const tmpDir = options.uploadDir ?? (UPLOAD_DIR || path.join(os.tmpdir(), 'telecloud-uploads'));
  // Remade for every upload rather than once at startup. Windows Storage Sense
  // and the other OS temp sweepers delete this folder out from under a
  // long-running server, and multer then fails each upload with a raw ENOENT
  // naming a temp path the person never chose — which reads as a broken file
  // rather than a missing directory the server can simply recreate.
  const stagingDir = (): string => {
    mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  };
  stagingDir();
  const maxUpload = configured ? MAX_FILE_BYTES : DEMO_MAX_BYTES;
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, done) => {
        try {
          done(null, stagingDir());
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          done(new HttpError(500, `The server could not prepare a staging folder for uploads: ${reason}`), '');
        }
      },
    }),
    limits: { fileSize: maxUpload, files: 1 },
  });
  const discard = (file?: Express.Multer.File) => {
    if (file?.path && existsSync(file.path)) {
      try { unlinkSync(file.path); } catch { /* the OS will reap the temp file */ }
    }
  };

  const app = express();
  const proxyHops = options.trustProxy ?? Number(process.env.TRUST_PROXY || 0);
  if (Number.isInteger(proxyHops) && proxyHops > 0) app.set('trust proxy', proxyHops);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '256kb' }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Slow down for a moment.' },
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
  });
  const qrPollLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many QR checks. Start a new login shortly.' },
  });
  // Telegram punishes repeated code requests with long flood waits, so this
  // path is throttled harder than ordinary sign-in.
  const linkLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many Telegram link attempts. Wait an hour before trying again.' },
  });
  app.use('/api', apiLimiter);
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Cross-site forms must not be able to replace an account or submit files.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      let foreignOrigin = false;
      if (origin) {
        try {
          const parsed = new URL(origin);
          const local = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1';
          foreignOrigin = parsed.host !== req.get('host')
            && !(local(parsed.hostname) && local(req.hostname));
        } catch { foreignOrigin = true; }
      }
      if (foreignOrigin || req.get('sec-fetch-site') === 'cross-site') {
        return res.status(403).json({ error: 'Open Telecloud directly to continue.' });
      }
    }
    next();
  });

  function readCookie(req: Request, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) {
        try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return undefined; }
      }
    }
    return undefined;
  }

  const browserSession = (req: Request) => sessions.get(readCookie(req, COOKIE));
  const siteAuthed = (req: Request) => !password || !!browserSession(req)?.siteAccess;
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: secureCookies, path: '/' };

  function issueSession(req: Request, res: Response, userId: string | null, ttl = SESSION_TTL): BrowserSession {
    const previous = browserSession(req);
    if (previous) { sessions.revoke(previous.id); pending.delete(previous.id); }
    const next = sessions.create(userId, true, ttl);
    res.cookie(COOKIE, next.token, { ...cookieOptions, maxAge: ttl });
    return next.session;
  }

  function vaultStore(req: Request): Store | null {
    if (demo) return demo.store;
    const browser = browserSession(req);
    return browser?.userId ? accounts.get(browser.userId).store : null;
  }

  function vaultUnlocked(req: Request): boolean {
    const browser = browserSession(req);
    return !!browser && unlockedVaults.has(browser.id);
  }

  function requireVault(req: Request, entry: Entry) {
    if (entry.vault && !vaultUnlocked(req)) throw new HttpError(423, 'Unlock the Secret Vault to access this item.');
  }

  function vaultHash(pin: string, salt = randomBytes(16).toString('hex')) {
    return `${salt}:${scryptSync(pin, salt, 64).toString('hex')}`;
  }

  function verifyVaultPin(pin: string, stored: string) {
    const [salt, expectedHex] = stored.split(':');
    if (!salt || !expectedHex) return false;
    const actual = scryptSync(pin, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  }

  function findEntry(store: Store, id: string): Entry {
    const entry = store.get(id);
    if (!entry) throw new HttpError(404, 'This item no longer exists.');
    return entry;
  }

  function pathId(req: Request): string {
    const value = req.params.id;
    return Array.isArray(value) ? value[0] : value;
  }

  function findFolder(store: Store, id: string | null | undefined): Entry | null {
    if (!id) return null;
    const folder = findEntry(store, id);
    if (folder.kind !== 'folder') throw new HttpError(400, 'That destination is not a folder.');
    if (folder.deleted_at) throw new HttpError(400, 'That folder is in the trash. Restore it first.');
    return folder;
  }

  /** Telegram is configured but no account is linked yet. */
  function requireStorage(req: Request): StorageClient {
    if (!configured) throw new HttpError(400, 'Telegram is not configured on this server.');
    const { storage } = workspace(req);
    if (!storage) throw new HttpError(409, 'Link your Telegram account before uploading files.');
    return storage;
  }

  function cleanName(raw: string): string {
    let name = raw;
    if (/[^\x00-\x7F]/.test(raw)) {
      const decoded = Buffer.from(raw, 'latin1').toString('utf8');
      if (!decoded.includes('\uFFFD')) name = decoded;
    }
    name = name.replace(/[\r\n\t\0]/g, ' ').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    if (!name) name = 'untitled';
    return name.slice(0, 200);
  }

  function inlineType(mime: string): string | null {
    const m = (mime || '').toLowerCase();
    if (/^image\/(png|jpeg|jpg|gif|webp|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(m)) return m;
    if (/^video\/(mp4|webm|ogg|quicktime|x-matroska|mpeg)$/.test(m)) return m;
    if (/^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|aac|flac|x-m4a|m4a|mp4)$/.test(m)) return m;
    if (m === 'application/pdf') return m;
    if (['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/jsonl'].includes(m)) return 'text/plain; charset=utf-8';
    return null;
  }

  function contentDisposition(name: string, inline: boolean) {
    const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  /** Parse a single-range header against a known size. */
  function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '')) return null;
    let start: number;
    let end: number;
    if (match[1] === '') {
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
    return { start, end };
  }

  async function hardDelete(current: Workspace, entry: Entry) {
    const { store, storage } = current;
    const all = [entry, ...store.descendants(entry.id)];
    if (storage) {
      for (const e of all) if (e.kind === 'file' && e.message_id) await storage.deleteFile(e.message_id);
    }
    for (const e of all) store.remove(e.id);
  }

  function sendHeaders(res: Response, entry: Entry, inline: boolean) {
    const type = inlineType(entry.mime);
    const allowInline = inline && !!type;
    const contentType = allowInline ? type! : entry.mime || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', contentDisposition(entry.name, allowInline));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Sandbox inline previews so stored HTML/SVG cannot script against the app.
    if (allowInline && contentType !== 'application/pdf') res.setHeader('Content-Security-Policy', 'sandbox');
    return allowInline;
  }

  function streamLocal(entry: Entry, req: Request, res: Response, inline: boolean) {
    const { store } = workspace(req);
    if (!entry.local_path) throw new HttpError(404, 'The stored file is missing.');
    const filePath = store.filePath(entry.local_path);
    if (!existsSync(filePath)) throw new HttpError(404, 'The stored file is missing.');
    const size = statSync(filePath).size;
    sendHeaders(res, entry, inline);
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      return res.end();
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    if (range) res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    const stream = createReadStream(filePath, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.destroy();
    });
    stream.pipe(res);
  }

  /** Stream a Telegram-stored file, honouring Range so media can seek. */
  async function streamTelegram(entry: Entry, req: Request, res: Response, inline: boolean) {
    const client = requireStorage(req);
    if (!entry.message_id) throw new HttpError(404, 'The stored file is missing.');
    const size = entry.size;
    sendHeaders(res, entry, inline);
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      return res.end();
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    if (range) res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    let aborted = false;
    req.on('close', () => { aborted = true; });
    try {
      for await (const chunk of client.download(entry.message_id, start, end)) {
        if (aborted || res.writableEnded) return;
        // Respect backpressure so a slow client cannot balloon server memory.
        if (!res.write(chunk)) await new Promise<void>((resolve) => res.once('drain', resolve));
      }
      res.end();
    } catch (error) {
      if (aborted) return;
      if (!res.headersSent) throw error;
      res.destroy();
    }
  }

  app.get('/api/auth/status', (req, res) => {
    const browser = browserSession(req);
    const access = siteAuthed(req);
    const account = configured && access && browser?.userId ? accounts.get(browser.userId) : null;
    const store = demo?.store ?? account?.store ?? null;
    res.json({
      passwordProtected: !!password,
      siteAuthed: access,
      authed: access && (!configured || !!account?.storage),
      mode,
      configured,
      // Only the "Telegram is switched off" reason is public: it tells a visitor
      // why the drive is local, and it names no credential. Warnings about a
      // credential that *is* set stay in the operator's console.
      setupHint: configured ? null : setup.hint,
      linked: !!account?.storage,
      telegram: account?.telegram ?? null,
      maxUploadBytes: maxUpload,
      vaultConfigured: !!store?.getSetting('vault_pin'),
      vaultUnlocked: vaultUnlocked(req),
    });
  });

  app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
    const { password: candidate } = loginSchema.parse(req.body ?? {});
    const given = createHash('sha256').update(candidate).digest();
    const expected = createHash('sha256').update(password).digest();
    if (!timingSafeEqual(given, expected)) throw new HttpError(401, 'Incorrect password. Try again.');
    issueSession(req, res, null);
    res.json({ ok: true });
  }));

  app.use('/api', (req, res, next) => {
    if (siteAuthed(req)) next();
    else res.status(401).json({ error: 'Please sign in to continue.' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const browser = browserSession(req);
    if (browser) { unlockedVaults.delete(browser.id); sessions.revoke(browser.id); pending.delete(browser.id); }
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  // --- Telegram account linking -------------------------------------------
  // Held in memory only: a half-finished auth key is as sensitive as the
  // finished one, and it should not outlive a server restart.
  type Pending = { phone: string; session: string; phoneCodeHash: string; at: number; step: 'code' | 'password' | 'qr'; busy: boolean; qr?: QrLogin };
  const pending = new Map<string, Pending>();
  const PENDING_TTL = 10 * 60 * 1000;
  const prunePending = () => {
    for (const [id, attempt] of pending) {
      if (Date.now() - attempt.at > PENDING_TTL) {
        pending.delete(id);
        void attempt.qr?.close();
      }
    }
  };
  const pendingTimer = setInterval(prunePending, 60_000);
  pendingTimer.unref();

  const freshPending = (req: Request, step: Pending['step']) => {
    prunePending();
    const browser = browserSession(req);
    const current = browser && pending.get(browser.id);
    if (!browser || !current) throw new HttpError(400, 'That login attempt expired. Start again with your phone number.');
    if (current.busy) throw new HttpError(409, 'Your sign-in is already being processed.');
    if (current.step !== step) throw new HttpError(400, 'Complete the previous sign-in step first.');
    return { browser, current };
  };

  const assertActiveAttempt = (req: Request, browser: BrowserSession, current: Pending) => {
    if (browserSession(req)?.id !== browser.id || pending.get(browser.id) !== current || Date.now() - current.at > PENDING_TTL) {
      throw new HttpError(400, 'That login attempt expired. Start again with your phone number.');
    }
  };

  app.post('/api/telegram/qr/start', linkLimiter, wrap(async (req, res) => {
    if (!configured) throw new HttpError(400, setup.hint ?? 'Set TELEGRAM_API_ID and TELEGRAM_API_HASH before linking an account.');
    const previous = browserSession(req);
    if (previous?.userId) throw new HttpError(409, 'Sign out before using a different Telegram account.');
    if (previous && pending.get(previous.id)?.busy) throw new HttpError(409, 'Your sign-in is already being processed.');
    const browser = issueSession(req, res, null, PENDING_TTL);
    const current: Pending = { phone: '', session: '', phoneCodeHash: '', at: Date.now(), step: 'qr', busy: true };
    prunePending();
    pending.set(browser.id, current);
    try {
      current.qr = await backend.startQrLogin(apiId, apiHash);
      if (pending.get(browser.id) !== current) throw new HttpError(400, 'That login attempt expired. Start again.');
      res.json(current.qr.current);
    } catch (error) {
      if (pending.get(browser.id) === current) pending.delete(browser.id);
      await current.qr?.close();
      throw error;
    } finally { current.busy = false; }
  }));

  app.get('/api/telegram/qr/poll', qrPollLimiter, wrap(async (req, res) => {
    const { browser, current } = freshPending(req, 'qr');
    if (!current.qr) throw new HttpError(400, 'That QR login is no longer available. Start again.');
    current.busy = true;
    try {
      const result = await current.qr.poll();
      assertActiveAttempt(req, browser, current);
      if (result.step === 'pending') {
        res.json(result);
        return;
      }
      const account = await accounts.activate(result.session);
      assertActiveAttempt(req, browser, current);
      await current.qr.close();
      pending.delete(browser.id);
      issueSession(req, res, result.session.userId);
      res.json({ step: 'done', telegram: account.telegram });
    } finally { current.busy = false; }
  }));

  app.post('/api/telegram/send-code', linkLimiter, wrap(async (req, res) => {
    if (!configured) throw new HttpError(400, setup.hint ?? 'Set TELEGRAM_API_ID and TELEGRAM_API_HASH before linking an account.');
    const { phone } = phoneSchema.parse(req.body ?? {});
    const normalized = phone.replace(/[^\d+]/g, '');
    const previous = browserSession(req);
    if (previous?.userId) throw new HttpError(409, 'Sign out before using a different Telegram account.');
    if (previous && pending.get(previous.id)?.busy) throw new HttpError(409, 'Your sign-in is already being processed.');
    const browser = issueSession(req, res, null, PENDING_TTL);
    const current: Pending = { phone: normalized, session: '', phoneCodeHash: '', at: Date.now(), step: 'code', busy: true };
    prunePending();
    pending.set(browser.id, current);
    try {
      const result = await backend.sendCode(apiId, apiHash, normalized);
      if (pending.get(browser.id) !== current) throw new HttpError(400, 'That login attempt expired. Start again.');
      current.session = result.session;
      current.phoneCodeHash = result.phoneCodeHash;
      res.json({ ok: true, step: 'code' });
    } catch (error) {
      if (pending.get(browser.id) === current) pending.delete(browser.id);
      throw error;
    } finally { current.busy = false; }
  }));

  app.post('/api/telegram/sign-in', loginLimiter, wrap(async (req, res) => {
    const { code } = codeSchema.parse(req.body ?? {});
    const { browser, current } = freshPending(req, 'code');
    current.busy = true;
    try {
      const result = await backend.signIn(apiId, apiHash, current.session, current.phone, current.phoneCodeHash, code);
      assertActiveAttempt(req, browser, current);
      if (result.step === 'password') {
        current.step = 'password';
        current.session = result.session;
        res.json({ ok: true, step: 'password', hint: result.hint });
        return;
      }
      const account = await accounts.activate(result.session);
      assertActiveAttempt(req, browser, current);
      issueSession(req, res, result.session.userId);
      res.json({ ok: true, step: 'done', telegram: account.telegram });
    } finally { current.busy = false; }
  }));

  app.post('/api/telegram/password', loginLimiter, wrap(async (req, res) => {
    const { password: cloudPassword } = twoFactorSchema.parse(req.body ?? {});
    const { browser, current } = freshPending(req, 'password');
    current.busy = true;
    try {
      const session = await backend.checkPassword(apiId, apiHash, current.session, cloudPassword);
      assertActiveAttempt(req, browser, current);
      const account = await accounts.activate(session);
      assertActiveAttempt(req, browser, current);
      issueSession(req, res, session.userId);
      res.json({ ok: true, step: 'done', telegram: account.telegram });
    } finally { current.busy = false; }
  }));

  app.post('/api/telegram/unlink', wrap(async (req, res) => {
    const browser = browserSession(req);
    if (!configured || !browser?.userId) throw new HttpError(401, 'Sign in with Telegram to continue.');
    sessions.revokeUser(browser.userId);
    await accounts.unlink(browser.userId);
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true });
  }));

  // Every drive route resolves its database from the verified browser identity.
  // This runs before multipart parsing, lookups, previews, and all mutations.
  app.use('/api', (req, res, next) => {
    if (demo) { requestWorkspaces.set(req, demo); return next(); }
    const browser = browserSession(req);
    if (!browser?.userId) return res.status(401).json({ error: 'Sign in with Telegram to continue.' });
    const account = accounts.get(browser.userId);
    if (!account.storage) return res.status(401).json({ error: 'Sign in with Telegram to continue.' });
    requestWorkspaces.set(req, account);
    next();
  });

  app.post('/api/vault/setup', wrap(async (req, res) => {
    const store = vaultStore(req);
    if (!store) throw new HttpError(401, 'Sign in before setting up the Secret Vault.');
    const { pin } = vaultPinSchema.parse(req.body ?? {});
    if (store.getSetting('vault_pin')) throw new HttpError(409, 'The Secret Vault is already set up. Enter its PIN to unlock it.');
    store.setSetting('vault_pin', vaultHash(pin));
    const browser = browserSession(req) ?? issueSession(req, res, null);
    if (browser) unlockedVaults.add(browser.id);
    await storeWorkspace(req);
    res.json({ ok: true, vaultConfigured: true, vaultUnlocked: true });
  }));

  app.post('/api/vault/unlock', wrap(async (req, res) => {
    const store = vaultStore(req);
    if (!store) throw new HttpError(401, 'Sign in before opening the Secret Vault.');
    const { pin } = vaultPinSchema.parse(req.body ?? {});
    const stored = store.getSetting('vault_pin');
    if (!stored) throw new HttpError(404, 'Set up the Secret Vault first.');
    if (!verifyVaultPin(pin, stored)) throw new HttpError(401, 'That vault PIN is incorrect.');
    const browser = browserSession(req) ?? issueSession(req, res, null);
    if (browser) unlockedVaults.add(browser.id);
    res.json({ ok: true, vaultConfigured: true, vaultUnlocked: true });
  }));

  app.post('/api/vault/lock', wrap(async (req, res) => {
    const browser = browserSession(req);
    if (browser) unlockedVaults.delete(browser.id);
    res.json({ ok: true, vaultUnlocked: false });
  }));

  // --- Entries -------------------------------------------------------------
  app.get('/api/entries', (req, res) => {
    const { store } = workspace(req);
    res.json({ entries: store.all().filter((e) => !e.vault || vaultUnlocked(req)).map((e) => store.publicEntry(e)) });
  });

  app.post('/api/folders', wrap(async (req, res) => {
    const { store } = workspace(req);
    // Folders are purely a database concept, so nesting is unrestricted and
    // creating one never touches Telegram.
    const input = folderSchema.extend({ vault: z.boolean().optional() }).parse(req.body ?? {});
    const parent = findFolder(store, input.parentId ?? null);
    const vault = input.vault ?? !!parent?.vault;
    if (parent && vault !== !!parent.vault) throw new HttpError(400, 'Vault folders can only contain vault items.');
    if (vault && !vaultUnlocked(req)) throw new HttpError(423, 'Unlock the Secret Vault first.');
    const entry = store.insert({
      name: input.name,
      kind: 'folder',
      color: input.color ?? 'purple',
      parent_id: parent?.id ?? null,
      vault: vault ? 1 : 0,
    });
    await storeWorkspace(req);
    res.status(201).json({ entry: store.publicEntry(entry) });
  }));

  app.post('/api/files', upload.single('file'), wrap(async (req, res) => {
    const { store } = workspace(req);
    const file = req.file;
    if (!file) throw new HttpError(400, 'Choose a file to upload.');
    try {
      const parent = findFolder(store, req.body.parentId || null);
      const vault = req.body.vault === 'true' || !!parent?.vault;
      if (parent && vault !== !!parent.vault) throw new HttpError(400, 'Vault folders can only contain vault items.');
      if (vault && !vaultUnlocked(req)) throw new HttpError(423, 'Unlock the Secret Vault first.');
      const name = cleanName(file.originalname);
      const mime = file.mimetype || 'application/octet-stream';

      if (configured) {
        const client = requireStorage(req);
        const sent = await client.upload(file.path, name, file.size, mime);
        const entry = store.insert({
          name, kind: 'file', mime, size: sent.size,
          parent_id: parent?.id ?? null, message_id: sent.messageId, vault: vault ? 1 : 0,
        });
        await storeWorkspace(req);
        res.status(201).json({ entry: store.publicEntry(entry) });
      } else {
        const id = randomUUID();
        await store.saveFile(id, createReadStream(file.path));
        const entry = store.insert({
          id, name, kind: 'file', mime, size: file.size,
          parent_id: parent?.id ?? null, local_path: id, vault: vault ? 1 : 0,
        });
        await storeWorkspace(req);
        res.status(201).json({ entry: store.publicEntry(entry) });
      }
    } finally {
      discard(file);
    }
  }));

  app.patch('/api/entries/:id', wrap(async (req, res) => {
    const { store, storage } = workspace(req);
    const entry = findEntry(store, pathId(req));
    requireVault(req, entry);
    if (entry.deleted_at) throw new HttpError(400, 'This item is in the trash. Restore it first.');
    const input = patchSchema.parse(req.body ?? {});

    if (input.name !== undefined && input.name !== entry.name) {
      if (storage && entry.kind === 'file' && entry.message_id) await storage.renameFile(entry.message_id, input.name);
      store.update(entry.id, { name: input.name });
    }

    if (input.color !== undefined) {
      if (entry.kind !== 'folder') throw new HttpError(400, 'Only folders can be recolored.');
      store.update(entry.id, { color: input.color });
    }

    if (input.starred !== undefined) store.update(entry.id, { starred: input.starred ? 1 : 0 });

    if (input.parentId !== undefined) {
      // Moving is a metadata change only — the file never leaves its channel.
      const target = findFolder(store, input.parentId);
      if (target) {
        if (target.id === entry.id) throw new HttpError(400, 'An item cannot be moved into itself.');
        if (entry.kind === 'folder' && store.descendants(entry.id).some((d) => d.id === target.id)) {
          throw new HttpError(400, 'A folder cannot be moved into its own subfolder.');
        }
      }
      store.update(entry.id, { parent_id: target?.id ?? null });
    }

    await storeWorkspace(req);
    res.json({ entry: store.publicEntry(store.get(entry.id)!) });
  }));

  app.delete('/api/entries/:id', wrap(async (req, res) => {
    const current = workspace(req);
    const { store } = current;
    const entry = findEntry(store, pathId(req));
    requireVault(req, entry);
    const permanent = req.query.permanent === '1';
    if (permanent) {
      await hardDelete(current, entry);
      await storeWorkspace(req);
      return res.json({ ok: true });
    }
    if (!entry.deleted_at) {
      const now = new Date().toISOString();
      store.update(entry.id, { deleted_at: now });
      if (entry.kind === 'folder') {
        for (const d of store.descendants(entry.id)) store.update(d.id, { deleted_at: now, trash_root: entry.id });
      }
    }
    await storeWorkspace(req);
    res.json({ ok: true });
  }));

  app.post('/api/entries/:id/restore', wrap(async (req, res) => {
    const { store } = workspace(req);
    const entry = findEntry(store, pathId(req));
    requireVault(req, entry);
    if (entry.deleted_at) {
      store.update(entry.id, { deleted_at: null, trash_root: null });
      if (entry.kind === 'folder') {
        for (const d of store.all()) if (d.trash_root === entry.id) store.update(d.id, { deleted_at: null, trash_root: null });
      }
    }
    await storeWorkspace(req);
    res.json({ entry: store.publicEntry(store.get(entry.id)!) });
  }));

  app.post('/api/trash/purge', wrap(async (req, res) => {
    const current = workspace(req);
    const { store } = current;
    for (const entry of store.all().filter((e) => e.deleted_at && !e.trash_root)) await hardDelete(current, entry);
    for (const leftover of store.all().filter((e) => e.deleted_at)) store.remove(leftover.id);
    await storeWorkspace(req);
    res.json({ ok: true });
  }));

  app.get(['/api/files/:id/download', '/api/files/:id/raw'], wrap(async (req, res) => {
    const entry = findEntry(workspace(req).store, pathId(req));
    requireVault(req, entry);
    if (entry.kind !== 'file') throw new HttpError(400, 'Only files can be downloaded.');
    if (entry.deleted_at) throw new HttpError(400, 'This file is in the trash. Restore it to open it.');
    const inline = req.path.endsWith('/raw');
    if (entry.message_id) return streamTelegram(entry, req, res, inline);
    streamLocal(entry, req, res, inline);
  }));

  app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    next();
  });

  const distIndex = path.join(rootDir, 'dist', 'index.html');
  if (existsSync(distIndex)) {
    app.use(express.static(path.join(rootDir, 'dist')));
    app.use((req, res) => res.sendFile(distIndex));
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof TelegramAuthError) {
      // A revoked Telegram session returns this browser to sign-in. Incorrect
      // 2FA passwords do not discard the pending login.
      const browser = browserSession(req);
      if (err.status === 401 && browser?.userId) {
        sessions.revokeUser(browser.userId);
        res.clearCookie(COOKIE, cookieOptions);
      }
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const limitMb = Math.round(maxUpload / (1024 * 1024));
        return res.status(413).json({
          error: `This file is too large. The ${configured ? 'Telegram' : 'local demo'} limit is ${limitMb} MB per file.`,
        });
      }
      return res.status(400).json({ error: `Upload failed: ${err.message}.` });
    }
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request.' });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'The request body is not valid JSON.' });
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Something went wrong.' });
  });

  return {
    app, mode, setup,
    close: async () => {
      clearInterval(pendingTimer);
      pending.clear();
      await accounts.close();
      demo?.store.close();
      sessions.close();
    },
  };
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

function wrap(fn: Handler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  try {
    const { app, mode, setup } = await createApp();
    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('  Telecloud — a little space for everything');
      if (mode === 'telegram') console.log('  Mode: Telegram — each user signs in with their own account');
      else console.log('  Mode: Local demo — files stay on this computer');
      // The one thing worth interrupting for: at a glance the demo and real
      // Telegram storage look identical, so an unread reason reads as a bug.
      if (setup.hint) console.log(`  ${mode === 'telegram' ? 'Warning' : 'Note'}: ${setup.hint}`);
      console.log(`  API listening on http://${HOST}:${PORT}`);
      console.log('');
    });
  } catch (error) {
    console.error(`\n  Telecloud could not start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
