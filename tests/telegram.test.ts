import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp, type AppInfo, type AppOptions } from '../server/index.js';
import { Store } from '../server/store.js';
import { alice, bob, carol, fakeTelegram, sessionFor } from './fake-telegram.js';

async function fixture(t: TestContext, options: AppOptions = {}, legacy = false) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'telecloud-users-'));
  const fake = fakeTelegram();
  if (legacy) {
    const store = new Store(dataDir, 'telegram');
    store.bindAccount(alice.id);
    store.saveSession(sessionFor(alice));
    store.insert({ name: 'Original folder', kind: 'folder' });
    store.close();
  }
  let server: Server;
  let info: AppInfo;
  let base: string;
  const start = async () => {
    info = await createApp({ dataDir, password: '', sessionSecret: 'test-secret', apiId: 12345, apiHash: 'test-api-hash', telegramBackend: fake.backend, ...options });
    server = info.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    base = `http://127.0.0.1:${address.port}`;
  };
  const stop = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await info.close();
  };
  await start();
  t.after(async () => {
    await stop();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('telecloud-users-'));
    rmSync(dataDir, { recursive: true, force: true });
  });

  const browser = () => {
    let cookie = '';
    const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const init: RequestInit = { method, headers: { ...(cookie ? { cookie } : {}), ...headers } };
      if (body instanceof FormData) init.body = body;
      else if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      }
      const response = await fetch(`${base}${url}`, init);
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return response;
    };
    const send = async (user: typeof alice) => {
      assert.equal((await call('POST', '/api/telegram/send-code', { phone: user.phone })).status, 200);
    };
    const login = async (user: typeof alice) => {
      await send(user);
      assert.equal((await call('POST', '/api/telegram/sign-in', { code: user.code })).status, 200);
    };
    const entries = async () => {
      const response = await call('GET', '/api/entries');
      assert.equal(response.status, 200);
      return (await response.json()).entries as { id: string; name: string; deleted_at: string | null }[];
    };
    const upload = async (name: string, bytes: string, parentId?: string) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'text/plain' }), name);
      if (parentId) form.append('parentId', parentId);
      return call('POST', '/api/files', form);
    };
    return { call, send, login, entries, upload, cookie: () => cookie };
  };
  return { browser, dataDir, fake, restart: async () => { await stop(); await start(); } };
}

test('Telegram mode requires personal login even without a site password', async (t) => {
  const { browser } = await fixture(t);
  const visitor = browser();
  const status = await (await visitor.call('GET', '/api/auth/status')).json();
  assert.deepEqual([status.authed, status.linked, status.telegram], [false, false, null]);
  for (const [method, route, body] of [
    ['GET', '/api/entries'], ['POST', '/api/folders', { name: 'No access' }], ['POST', '/api/files'],
    ['GET', '/api/files/unknown/raw'], ['DELETE', '/api/entries/unknown'], ['POST', '/api/trash/purge'],
    ['POST', '/api/telegram/unlink'],
  ] as const) assert.equal((await visitor.call(method, route, body)).status, 401);
  assert.equal((await visitor.call('GET', '/api/entries', undefined, { cookie: 'telecloud_session=%ZZ' })).status, 401);
});

test('simultaneous users cannot exchange login codes or access each other’s drive', async (t) => {
  const { browser, fake } = await fixture(t);
  const a = browser();
  const b = browser();
  const visitor = browser();
  await Promise.all([a.send(alice), b.send(bob)]);
  assert.equal((await a.call('POST', '/api/telegram/sign-in', { code: bob.code })).status, 400);
  assert.equal((await visitor.call('POST', '/api/telegram/sign-in', { code: alice.code })).status, 400);
  const pendingCookie = a.cookie();
  await Promise.all([
    a.call('POST', '/api/telegram/sign-in', { code: alice.code }).then((r) => assert.equal(r.status, 200)),
    b.call('POST', '/api/telegram/sign-in', { code: bob.code }).then((r) => assert.equal(r.status, 200)),
  ]);
  assert.notEqual(a.cookie(), pendingCookie);
  assert.equal((await visitor.call('GET', '/api/entries', undefined, { cookie: pendingCookie })).status, 401);
  assert.equal((await (await a.call('GET', '/api/auth/status')).json()).telegram.account, 'Alice');
  assert.equal((await (await b.call('GET', '/api/auth/status')).json()).telegram.account, 'Bob');
  const publicStatus = await visitor.call('GET', '/api/auth/status');
  assert.equal((await publicStatus.json()).telegram, null);
  assert.equal(publicStatus.headers.get('cache-control'), 'no-store');

  const folder = (await (await a.call('POST', '/api/folders', { name: 'Alice private' })).json()).entry;
  const aFile = (await (await a.upload('alice.txt', 'alice bytes', folder.id)).json()).entry;
  const bFile = (await (await b.upload('bob.txt', 'bob bytes')).json()).entry;
  assert.deepEqual((await b.entries()).map((e) => e.name), ['bob.txt']);
  assert.equal(await (await a.call('GET', `/api/files/${aFile.id}/download`)).text(), 'alice bytes');
  assert.equal(await (await b.call('GET', `/api/files/${bFile.id}/raw`)).text(), 'bob bytes');
  for (const [method, route, body] of [
    ['GET', `/api/files/${aFile.id}/download`], ['GET', `/api/files/${aFile.id}/raw`],
    ['PATCH', `/api/entries/${aFile.id}`, { name: 'Stolen' }],
    ['DELETE', `/api/entries/${aFile.id}?permanent=1`], ['POST', `/api/entries/${aFile.id}/restore`],
    ['POST', '/api/folders', { name: 'Foreign child', parentId: folder.id }],
    ['PATCH', `/api/entries/${bFile.id}`, { parentId: folder.id }],
  ] as const) assert.equal((await b.call(method, route, body)).status, 404);
  assert.equal((await b.upload('no.txt', 'cannot upload here', folder.id)).status, 404);
  await a.call('DELETE', `/api/entries/${folder.id}`);
  await b.call('POST', '/api/trash/purge');
  assert.equal(fake.files.get(alice.id)?.size, 1);
  await a.call('POST', '/api/trash/purge');
  assert.equal(fake.files.get(alice.id)?.size, 0);
  assert.equal(fake.files.get(bob.id)?.size, 1);
});

test('two-step verification is browser scoped and preserves the updated Telegram session', async (t) => {
  const { browser } = await fixture(t);
  const a = browser();
  const c = browser();
  await c.send(carol);
  assert.equal((await c.call('POST', '/api/telegram/password', { password: carol.password })).status, 400);
  const step = await (await c.call('POST', '/api/telegram/sign-in', { code: carol.code })).json();
  assert.equal(step.step, 'password');
  assert.equal('session' in step, false);
  assert.equal((await c.call('GET', '/api/entries')).status, 401);
  await a.login(alice);
  assert.equal((await a.call('POST', '/api/telegram/password', { password: carol.password })).status, 400);
  assert.equal((await c.call('POST', '/api/telegram/password', { password: 'wrong' })).status, 401);
  assert.equal((await c.call('POST', '/api/telegram/password', { password: carol.password })).status, 200);
  assert.equal((await (await c.call('GET', '/api/auth/status')).json()).telegram.account, 'Carol');
});

test('sign out revokes the cookie, permits account switching, and keeps other browsers signed in', async (t) => {
  const { browser } = await fixture(t);
  const a = browser();
  const other = browser();
  await a.login(alice);
  await a.call('POST', '/api/folders', { name: 'Alice saved' });
  await other.login(alice);
  const oldCookie = a.cookie();
  assert.equal((await a.call('POST', '/api/auth/logout')).status, 200);
  assert.equal((await a.call('GET', '/api/entries', undefined, { cookie: oldCookie })).status, 401);
  assert.equal((await other.entries())[0].name, 'Alice saved');
  await a.login(bob);
  assert.deepEqual(await a.entries(), []);
  await a.call('POST', '/api/auth/logout');
  await a.login(alice);
  assert.equal((await a.entries())[0].name, 'Alice saved');
});

test('unlink affects only that account and its own browsers; metadata survives relinking', async (t) => {
  const { browser } = await fixture(t);
  const a = browser();
  const a2 = browser();
  const b = browser();
  await a.login(alice);
  await a.call('POST', '/api/folders', { name: 'Keep me' });
  await a2.login(alice);
  await b.login(bob);
  assert.equal((await a.call('POST', '/api/telegram/unlink')).status, 200);
  assert.equal((await a2.call('GET', '/api/entries')).status, 401);
  assert.equal((await b.call('GET', '/api/entries')).status, 200);
  await a.login(alice);
  assert.equal((await a.entries())[0].name, 'Keep me');
});

test('browser login and account databases survive a server restart', async (t) => {
  const { browser, restart } = await fixture(t);
  const a = browser();
  const b = browser();
  await a.login(alice);
  await b.login(bob);
  await a.upload('persist.txt', 'persistent bytes');
  await b.call('POST', '/api/folders', { name: 'Bob persistent' });
  const pending = browser();
  await pending.send(carol);
  await restart();
  assert.deepEqual((await a.entries()).map((e) => e.name), ['persist.txt']);
  assert.deepEqual((await b.entries()).map((e) => e.name), ['Bob persistent']);
  const file = (await a.entries())[0];
  assert.equal(await (await a.call('GET', `/api/files/${file.id}/download`)).text(), 'persistent bytes');
  assert.equal((await pending.call('POST', '/api/telegram/sign-in', { code: carol.code })).status, 400);
});

test('legacy data is visible only after the original owner signs in', async (t) => {
  const { browser } = await fixture(t, {}, true);
  const a = browser();
  const b = browser();
  assert.equal((await (await a.call('GET', '/api/auth/status')).json()).telegram, null);
  await b.login(bob);
  assert.deepEqual(await b.entries(), []);
  await a.login(alice);
  assert.deepEqual((await a.entries()).map((e) => e.name), ['Original folder']);
});

test('failed Telegram verification and expired browser sessions never grant access', async (t) => {
  const { browser, fake, dataDir } = await fixture(t);
  const a = browser();
  fake.refused.add(alice.id);
  await a.send(alice);
  assert.equal((await a.call('POST', '/api/telegram/sign-in', { code: alice.code })).status, 502);
  assert.equal((await a.call('GET', '/api/entries')).status, 401);
  fake.refused.clear();
  assert.equal((await a.call('POST', '/api/telegram/sign-in', { code: alice.code })).status, 200);
  const db = new DatabaseSync(path.join(dataDir, 'sessions.sqlite'));
  db.exec('UPDATE browser_sessions SET expiresAt=0');
  db.close();
  assert.equal((await a.call('GET', '/api/entries')).status, 401);
});

test('optional site password does not grant access to a Telegram account', async (t) => {
  const { browser } = await fixture(t, { password: 'site-password', secureCookies: true });
  const a = browser();
  assert.equal((await a.call('POST', '/api/telegram/send-code', { phone: alice.phone })).status, 401);
  const login = await a.call('POST', '/api/auth/login', { password: 'site-password' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await a.call('GET', '/api/entries')).status, 401);
  const status = await (await a.call('GET', '/api/auth/status')).json();
  assert.equal(status.siteAuthed, true);
  assert.equal(status.authed, false);
  await a.login(alice);
  assert.equal((await a.call('GET', '/api/entries')).status, 200);
});

test('cross-site login and upload attempts are rejected', async (t) => {
  const { browser } = await fixture(t);
  const a = browser();
  assert.equal((await a.call('POST', '/api/telegram/send-code', { phone: alice.phone }, { origin: 'https://unrelated.example' })).status, 403);
  await a.login(alice);
  assert.equal((await a.call('POST', '/api/files', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
});

test('signing out while Telegram is verifying a code cannot recreate the browser login', async (t) => {
  const { browser, fake } = await fixture(t);
  const a = browser();
  await a.send(alice);
  const original = fake.backend.signIn;
  let started!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  fake.backend.signIn = async (...args) => {
    started();
    await blocked;
    return original(...args);
  };
  const response = a.call('POST', '/api/telegram/sign-in', { code: alice.code });
  await waiting;
  assert.equal((await a.call('POST', '/api/auth/logout')).status, 200);
  release();
  assert.equal((await response).status, 400);
  assert.equal((await a.call('GET', '/api/entries')).status, 401);
});

test('a revoked Telegram connection invalidates only that account’s browser sessions', async (t) => {
  const { browser, fake } = await fixture(t);
  const a = browser();
  const b = browser();
  await a.login(alice);
  await b.login(bob);
  const file = (await (await a.upload('revoke.txt', 'private bytes')).json()).entry;
  fake.revoked.add(alice.id);
  assert.equal((await a.call('GET', `/api/files/${file.id}/download`)).status, 401);
  assert.equal((await a.call('GET', '/api/entries')).status, 401);
  assert.equal((await b.call('GET', '/api/entries')).status, 200);
});
