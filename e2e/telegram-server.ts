import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { fakeTelegram } from '../tests/fake-telegram.js';

// Test-only entrypoint: the production server never loads this backend.
const { app } = await createApp({
  dataDir: mkdtempSync(path.join(tmpdir(), 'telecloud-browser-')),
  password: '', sessionSecret: 'browser-tests', apiId: 12345, apiHash: 'browser-tests',
  telegramBackend: fakeTelegram().backend,
});
app.listen(3002, '127.0.0.1');
