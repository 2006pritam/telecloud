import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { TelegramBackend } from '../server/accounts.js';
import { TelegramAuthError, type Session } from '../server/telegram.js';

export const alice = { phone: '+15550001001', code: '11111', id: '1001', name: 'Alice' };
export const bob = { phone: '+15550001002', code: '22222', id: '1002', name: 'Bob' };
export const carol = { phone: '+15550001003', code: '33333', id: '1003', name: 'Carol', password: 'cloud-password' };

export function sessionFor(user: typeof alice): Session {
  return { session: `verified-${user.id}`, userId: user.id, name: user.name, channelId: `${user.id}0`, accessHash: '123456' };
}

/** An in-process Telegram boundary; HTTP authentication and databases remain real. */
export function fakeTelegram() {
  const users = [alice, bob, carol];
  const pending = new Map<string, { phone: string; hash: string; password: boolean }>();
  const files = new Map<string, Map<number, Buffer>>();
  const refused = new Set<string>();
  const revoked = new Set<string>();
  const backend: TelegramBackend = {
    async sendCode(_apiId, _apiHash, phone) {
      if (!users.some((user) => user.phone === phone)) throw new TelegramAuthError('Invalid phone number.');
      const session = randomUUID();
      const phoneCodeHash = randomUUID();
      pending.set(session, { phone, hash: phoneCodeHash, password: false });
      return { session, phoneCodeHash };
    },
    async signIn(_apiId, _apiHash, session, phone, hash, code) {
      const attempt = pending.get(session);
      const user = users.find((user) => user.phone === phone);
      if (!attempt || attempt.phone !== phone || attempt.hash !== hash || user?.code !== code) {
        throw new TelegramAuthError('That code is incorrect.');
      }
      if (user.id === carol.id) {
        const nextSession = randomUUID();
        pending.delete(session);
        pending.set(nextSession, { ...attempt, password: true });
        return { step: 'password', session: nextSession, hint: 'Your cloud password' };
      }
      return { step: 'done', session: sessionFor(user) };
    },
    async checkPassword(_apiId, _apiHash, session, password) {
      const attempt = pending.get(session);
      if (!attempt?.password || password !== carol.password) throw new TelegramAuthError('Incorrect two-step verification password.', 401);
      return sessionFor(carol);
    },
    createStorage(_apiId, _apiHash, session) {
      let closed = false;
      const check = () => {
        if (revoked.has(session.userId)) throw new TelegramAuthError('This Telegram session has expired.', 401);
        if (closed) throw new Error('Storage is closed.');
      };
      const accountFiles = files.get(session.userId) ?? new Map<number, Buffer>();
      files.set(session.userId, accountFiles);
      return {
        async verify() {
          check();
          if (refused.has(session.userId)) throw new TelegramAuthError('Telegram is unavailable.', 502);
          return { account: session.name, channel: 'Telecloud Storage' };
        },
        async upload(filePath, _name, size) {
          check();
          const messageId = Math.max(0, ...accountFiles.keys()) + 1;
          accountFiles.set(messageId, await readFile(filePath));
          return { messageId, size };
        },
        async *download(messageId, start = 0, end) {
          check();
          const bytes = accountFiles.get(messageId);
          if (!bytes) throw new TelegramAuthError('Missing file.', 404);
          yield bytes.subarray(start, end === undefined ? undefined : end + 1);
        },
        async renameFile() { check(); },
        async deleteFile(messageId) { check(); accountFiles.delete(messageId); },
        async close() { closed = true; },
      };
    },
  };
  return { backend, files, refused, revoked };
}
