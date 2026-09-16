import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectTelegram } from '../server/index.js';

/** A well-formed hash that is not the one the README uses as an example. */
const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('a well-formed credential pair switches Telegram storage on', () => {
  const setup = inspectTelegram('34287824', HASH);
  assert.deepEqual(setup, { apiId: 34287824, apiHash: HASH, configured: true, hint: null });
});

test('credentials survive the whitespace that copying and pasting adds', () => {
  const setup = inspectTelegram('  34287824\t', `\n ${HASH.toUpperCase()}  `);
  assert.equal(setup.configured, true);
  assert.equal(setup.apiId, 34287824);
  assert.equal(setup.apiHash, HASH.toUpperCase());
  assert.equal(setup.hint, null);
});

test('an unconfigured server explains how to turn Telegram on', () => {
  const setup = inspectTelegram('', '');
  assert.equal(setup.configured, false);
  assert.match(setup.hint ?? '', /TELEGRAM_API_ID and TELEGRAM_API_HASH are not set/);
  assert.match(setup.hint ?? '', /my\.telegram\.org/);
});

test('a half-filled pair names the credential that is missing', () => {
  const idOnly = inspectTelegram('34287824', '');
  assert.equal(idOnly.configured, false);
  assert.match(idOnly.hint ?? '', /TELEGRAM_API_HASH is empty/);

  const hashOnly = inspectTelegram('', HASH);
  assert.equal(hashOnly.configured, false);
  assert.match(hashOnly.hint ?? '', /TELEGRAM_API_ID is empty/);
});

test('an API ID that is not a number is reported rather than coerced to demo mode', () => {
  const setup = inspectTelegram('my application 5655', HASH);
  assert.equal(setup.configured, false);
  assert.equal(setup.apiId, 0);
  assert.match(setup.hint ?? '', /must be the number from my\.telegram\.org/);
  // Quoting the value back is what tells someone they pasted the wrong field.
  assert.match(setup.hint ?? '', /my application 5655/);
});

test('the example credentials from the README do not count as configured', () => {
  const setup = inspectTelegram('1234567', '0123456789ABCDEF0123456789abcdef');
  assert.equal(setup.configured, false);
  assert.match(setup.hint ?? '', /example API hash/);
});

test('a malformed hash still links, but warns instead of failing silently', () => {
  const setup = inspectTelegram(12345, 'test-api-hash');
  assert.equal(setup.configured, true);
  assert.equal(setup.apiHash, 'test-api-hash');
  assert.match(setup.hint ?? '', /32-character hexadecimal hash/);
});

test('an API ID of zero is treated as absent, not as a valid account', () => {
  assert.equal(inspectTelegram(0, '').configured, false);
  assert.equal(inspectTelegram(0, HASH).configured, false);
});
