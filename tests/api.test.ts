import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from '../server/index.js';

let base = '';
let server: Server | null = null;
let dataDir = '';
let cookie = '';
let closeStore: () => Promise<void> = async () => {};

async function startApp(options: { password?: string } = {}) {
  dataDir = mkdtempSync(path.join(tmpdir(), 'telecloud-test-'));
  const info = await createApp({ dataDir, password: options.password ?? '', apiId: 0, apiHash: '' });
  closeStore = info.close;
  server = info.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
}

async function call(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const init: RequestInit & { headers: Record<string, string> } = { method, headers: { ...extraHeaders } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  if (cookie) init.headers.cookie = cookie;
  const res = await fetch(`${base}${url}`, init);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

before(async () => {
  await startApp();
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await closeStore();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe('demo mode CRUD', () => {
  test('status reports demo mode without a password', async () => {
    const res = await call('GET', '/api/auth/status');
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.equal(data.mode, 'demo');
    assert.equal(data.passwordProtected, false);
    assert.equal(data.authed, true);
    // Without API credentials the app is unconfigured and unlinked.
    assert.equal(data.configured, false);
    assert.equal(data.linked, false);
    assert.equal(typeof data.maxUploadBytes, 'number');
  });

  test('refuses to link Telegram when unconfigured', async () => {
    const res = await call('POST', '/api/telegram/send-code', { phone: '+15551234567' });
    assert.equal(res.status, 400);
    assert.match(String((await json(res)).error), /API_ID|API_HASH/i);
  });

  test('validates the phone number before contacting Telegram', async () => {
    const res = await call('POST', '/api/telegram/send-code', { phone: 'not-a-number' });
    assert.equal(res.status, 400);
  });

  test('rejects a sign-in attempt with no pending code', async () => {
    const res = await call('POST', '/api/telegram/sign-in', { code: '12345' });
    assert.equal(res.status, 400);
    assert.match(String((await json(res)).error), /expired|start again/i);
  });

  test('creates a folder', async () => {
    const res = await call('POST', '/api/folders', { name: 'Projects', color: 'blue', parentId: null });
    assert.equal(res.status, 201);
    const data = await json(res);
    const entry = data.entry as Record<string, unknown>;
    assert.equal(entry.name, 'Projects');
    assert.equal(entry.kind, 'folder');
    assert.equal(entry.color, 'blue');
    assert.equal(entry.parent_id, null);
    assert.equal('message_id' in entry, false);
  });

  test('rejects invalid folder names', async () => {
    const res = await call('POST', '/api/folders', { name: '   ' });
    assert.equal(res.status, 400);
    const data = await json(res);
    assert.ok(typeof data.error === 'string' && data.error.length > 0);
  });

  test('uploads a file into the folder', async () => {
    const folders = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string }[];
    const folder = folders.find((f) => f.kind === 'folder');
    assert.ok(folder);
    const form = new FormData();
    form.append('file', new Blob(['hello telecloud'], { type: 'text/plain' }), 'greeting.txt');
    form.append('parentId', folder.id);
    const res = await call('POST', '/api/files', form);
    assert.equal(res.status, 201);
    const entry = (await json(res)).entry as Record<string, unknown>;
    assert.equal(entry.name, 'greeting.txt');
    assert.equal(entry.kind, 'file');
    assert.equal(entry.size, 15);
    assert.equal(entry.mime, 'text/plain');
  });

  test('renames and stars the file', async () => {
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string; name: string }[];
    const file = entries.find((e) => e.kind === 'file');
    assert.ok(file);
    const renamed = await json(await call('PATCH', `/api/entries/${file.id}`, { name: 'hello.txt', starred: true }));
    const entry = renamed.entry as Record<string, unknown>;
    assert.equal(entry.name, 'hello.txt');
    assert.equal(entry.starred, true);
  });

  test('moves the file to root', async () => {
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string }[];
    const file = entries.find((e) => e.kind === 'file');
    const moved = await json(await call('PATCH', `/api/entries/${file.id}`, { parentId: null }));
    const entry = moved.entry as Record<string, unknown>;
    assert.equal(entry.parent_id, null);
  });

  test('downloads the file with the original bytes', async () => {
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string }[];
    const file = entries.find((e) => e.kind === 'file');
    const res = await call('GET', `/api/files/${file.id}/download`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'hello telecloud');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment/);
  });

  test('serves text files inline for previews', async () => {
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string }[];
    const file = entries.find((e) => e.kind === 'file');
    const res = await call('GET', `/api/files/${file.id}/raw`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
    assert.match(res.headers.get('content-disposition') ?? '', /^inline/);
  });

  test('supports range requests for streaming', async () => {
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string }[];
    const file = entries.find((e) => e.kind === 'file');
    const res = await call('GET', `/api/files/${file.id}/raw`, undefined, { range: 'bytes=0-4' });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), 'hello');
  });

  test('trashes and restores the file', async () => {
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; kind: string }[];
    const file = entries.find((e) => e.kind === 'file');
    assert.equal((await call('DELETE', `/api/entries/${file.id}`)).status, 200);
    const afterDelete = (await json(await call('GET', '/api/entries'))).entries as { id: string; deleted_at: string | null }[];
    assert.ok(afterDelete.find((e) => e.id === file.id)?.deleted_at);
    assert.equal((await call('POST', `/api/entries/${file.id}/restore`)).status, 200);
    const afterRestore = (await json(await call('GET', '/api/entries'))).entries as { id: string; deleted_at: string | null }[];
    assert.equal(afterRestore.find((e) => e.id === file.id)?.deleted_at, null);
  });

  test('trashing a folder sweeps its contents', async () => {
    const folder = (await json(await call('POST', '/api/folders', { name: 'Sweep me', color: 'green' }))).entry as { id: string };
    const form = new FormData();
    form.append('file', new Blob(['nested'], { type: 'text/plain' }), 'nested.txt');
    form.append('parentId', folder.id);
    await call('POST', '/api/files', form);
    assert.equal((await call('DELETE', `/api/entries/${folder.id}`)).status, 200);
    const entries = (await json(await call('GET', '/api/entries'))).entries as { id: string; deleted_at: string | null; trash_root: string | null }[];
    assert.ok(entries.find((e) => e.id === folder.id)?.deleted_at);
    assert.equal(entries.find((e) => e.name === 'nested.txt')?.trash_root, folder.id);
  });

  test('purging the trash removes everything permanently', async () => {
    assert.equal((await call('POST', '/api/trash/purge')).status, 200);
    const entries = (await json(await call('GET', '/api/entries'))).entries as { deleted_at: string | null }[];
    assert.equal(entries.filter((e) => e.deleted_at).length, 0);
  });

  test('unknown API routes return 404 JSON', async () => {
    const res = await call('GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.ok((await json(res)).error);
  });
});

describe('password protection', () => {
  let guardBase = '';
  let guardServer: Server | null = null;
  let guardDataDir = '';
  let guardCookie = '';
  let guardClose: () => Promise<void> = async () => {};

  before(async () => {
    guardDataDir = mkdtempSync(path.join(tmpdir(), 'telecloud-guard-'));
    const info = await createApp({ dataDir: guardDataDir, password: 'sesame', apiId: 0, apiHash: '' });
    guardClose = info.close;
    guardServer = info.app.listen(0, '127.0.0.1');
    await once(guardServer, 'listening');
    const address = guardServer.address();
    assert.ok(address && typeof address === 'object');
    guardBase = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => guardServer?.close(() => resolve()));
    await guardClose();
    rmSync(guardDataDir, { recursive: true, force: true });
  });

  const guard = async (method: string, url: string, body?: unknown) => {
    const init: RequestInit & { headers: Record<string, string> } = { method, headers: {} };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    if (guardCookie) init.headers.cookie = guardCookie;
    const res = await fetch(`${guardBase}${url}`, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) guardCookie = setCookie.split(';')[0];
    return res;
  };

  test('blocks entries without a session', async () => {
    const res = await guard('GET', '/api/entries');
    assert.equal(res.status, 401);
  });

  test('rejects the wrong password', async () => {
    const res = await guard('POST', '/api/auth/login', { password: 'wrong' });
    assert.equal(res.status, 401);
  });

  test('signs in with the right password and unlocks the API', async () => {
    guardCookie = '';
    const login = await guard('POST', '/api/auth/login', { password: 'sesame' });
    assert.equal(login.status, 200);
    assert.ok(guardCookie.startsWith('telecloud_session='));
    const entries = await guard('GET', '/api/entries');
    assert.equal(entries.status, 200);
    const status = await guard('GET', '/api/auth/status');
    const data = (await status.json()) as { passwordProtected: boolean; authed: boolean };
    assert.deepEqual([data.passwordProtected, data.authed], [true, true]);
  });

  test('rejects a session cookie signed with an empty secret', async () => {
    // No SESSION_SECRET is configured here, so the signing key must fall back to
    // one derived from the password. If it ever signs with '' instead, this
    // forged cookie would authenticate and the password would mean nothing.
    const payload = Buffer.from(JSON.stringify({ a: 1, exp: Date.now() + 60_000 })).toString('base64url');
    const forged = `${payload}.${createHmac('sha256', '').update(payload).digest('base64url')}`;
    const res = await fetch(`${guardBase}/api/entries`, {
      headers: { cookie: `telecloud_session=${forged}` },
    });
    assert.equal(res.status, 401);
  });
});
