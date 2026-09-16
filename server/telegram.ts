import { TelegramClient, Api, sessions } from 'telegram';
import { computeCheck } from 'telegram/Password.js';
import { CustomFile } from 'telegram/client/uploads.js';
import bigInt from 'big-integer';

/**
 * Telegram storage backed by a real user account over MTProto.
 *
 * A user account rather than a bot lifts the 50 MB Bot API ceiling to 2 GB per
 * file. Folders are not represented here at all — they live in SQLite — so this
 * module only has to move bytes in and out of one private channel.
 */

/** Telegram's own per-file ceiling for non-Premium accounts. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** Telegram requires getFile offsets to land on a 4 KB boundary. */
const ALIGN = 4096;
const CHUNK = 512 * 1024;

export type Session = { session: string; userId: string; name: string; channelId: string; accessHash: string };

export type LoginStep = { step: 'password'; hint: string; session: string } | { step: 'done'; session: Session };

export class TelegramAuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Telegram's raw error strings are terse and leak internals; these do not. */
function friendly(error: unknown): TelegramAuthError {
  const raw = error instanceof Error ? error.message : String(error);
  const flood = /FLOOD_WAIT_(\d+)/.exec(raw);
  if (flood) {
    const seconds = Number(flood[1] || 0);
    const wait =
      seconds >= 3600 ? `${Math.ceil(seconds / 3600)} hour(s)`
      : seconds >= 60 ? `${Math.ceil(seconds / 60)} minute(s)`
      : `${seconds} second(s)`;
    return new TelegramAuthError(`Telegram is rate limiting this account. Try again in ${wait}.`, 429);
  }
  const map: [RegExp, string, number][] = [
    [/PHONE_NUMBER_INVALID/, 'That phone number is not valid. Include the country code, like +15551234567.', 400],
    [/PHONE_NUMBER_BANNED/, 'This phone number has been banned by Telegram.', 403],
    [/PHONE_CODE_INVALID/, 'That code is incorrect. Check Telegram and try again.', 400],
    [/PHONE_CODE_EXPIRED/, 'That code has expired. Start again to request a new one.', 400],
    [/PASSWORD_HASH_INVALID/, 'Incorrect two-step verification password.', 401],
    [/SESSION_PASSWORD_NEEDED/, 'This account needs its two-step verification password.', 401],
    [/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED/,
      'This Telegram session is no longer valid. Link the account again.', 401],
    [/FILE_PARTS_INVALID|FILE_PART_.*_MISSING|FILE_REFERENCE_EXPIRED/,
      'The transfer was interrupted. Please try again.', 502],
    [/CHAT_WRITE_FORBIDDEN|CHANNEL_PRIVATE/, 'Telegram refused the write to the storage channel.', 403],
    [/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/, 'Telegram rejected these API credentials. Check TELEGRAM_API_ID and TELEGRAM_API_HASH.', 401],
  ];
  for (const [pattern, message, status] of map) {
    if (pattern.test(raw)) return new TelegramAuthError(message, status);
  }
  return new TelegramAuthError(`Telegram error: ${raw}`, 502);
}

async function connect(apiId: number, apiHash: string, session = ''): Promise<TelegramClient> {
  const client = new TelegramClient(new sessions.StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    requestRetries: 3,
    autoReconnect: true,
  });
  // GramJS is chatty at info level, which drowns out the server's own logging.
  // Quieting it is cosmetic, so never let it break connecting.
  try {
    (client as unknown as { setLogLevel?: (level: string) => void }).setLogLevel?.('none');
  } catch {
    /* older GramJS builds name this differently; noisy logs are harmless */
  }
  try {
    await client.connect();
  } catch (error) {
    await client.disconnect().catch(() => {});
    throw friendly(error);
  }
  return client;
}

/** Step 1 of linking an account: ask Telegram to send a login code. */
export async function sendCode(apiId: number, apiHash: string, phone: string): Promise<{ phoneCodeHash: string; session: string }> {
  const client = await connect(apiId, apiHash);
  try {
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );
    if (result instanceof Api.auth.SentCodeSuccess) {
      throw new TelegramAuthError('This session is already signed in. Restart the server and try again.', 400);
    }
    if (!(result instanceof Api.auth.SentCode)) {
      throw new TelegramAuthError('Telegram could not send a login code to this number.', 400);
    }
    // The half-finished auth key must survive until the code is submitted.
    return { phoneCodeHash: result.phoneCodeHash, session: (client.session as sessions.StringSession).save() };
  } catch (error) {
    throw error instanceof TelegramAuthError ? error : friendly(error);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Step 2: exchange the login code for a session, or discover that 2FA is on. */
export async function signIn(
  apiId: number,
  apiHash: string,
  session: string,
  phone: string,
  phoneCodeHash: string,
  code: string
): Promise<LoginStep> {
  const client = await connect(apiId, apiHash, session);
  try {
    try {
      const authorization = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
      if (authorization instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new TelegramAuthError('Create your account in Telegram first, then sign in here.');
      }
    } catch (error) {
      if (/SESSION_PASSWORD_NEEDED/.test(error instanceof Error ? error.message : String(error))) {
        const info = await client.invoke(new Api.account.GetPassword());
        return { step: 'password', hint: info.hint ?? '', session: (client.session as sessions.StringSession).save() };
      }
      throw error instanceof TelegramAuthError ? error : friendly(error);
    }
    return { step: 'done', session: await finish(client) };
  } catch (error) {
    throw error instanceof TelegramAuthError ? error : friendly(error);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Step 3 (only when 2FA is on): verify the cloud password via SRP. */
export async function checkPassword(apiId: number, apiHash: string, session: string, password: string): Promise<Session> {
  const client = await connect(apiId, apiHash, session);
  try {
    const info = await client.invoke(new Api.account.GetPassword());
    // computeCheck runs the SRP exchange, so the password never leaves the machine.
    await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(info, password) }));
    return await finish(client);
  } catch (error) {
    throw error instanceof TelegramAuthError ? error : friendly(error);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Find or create the private channel that holds every uploaded file. A
 * dedicated channel keeps Telecloud's files out of Saved Messages and gives the
 * owner one place to erase everything if they ever want to.
 */
async function finish(client: TelegramClient): Promise<Session> {
  const me = await client.getMe();
  if (!(me instanceof Api.User)) throw new TelegramAuthError('Could not read the Telegram account.', 502);
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ')
    || (me.username ? `@${me.username}` : '')
    || me.phone || 'Telegram user';

  const title = 'Telecloud Storage';
  let channel: Api.Channel | null = null;
  for await (const dialog of client.iterDialogs({})) {
    const entity = dialog.entity;
    // `creator` matters: adopting someone else's identically-named channel would
    // point this account's storage at a chat it does not control.
    if (entity instanceof Api.Channel && entity.title === title && entity.creator && !entity.left && !entity.username && !entity.megagroup) {
      channel = entity;
      break;
    }
  }
  if (!channel) {
    const created = await client.invoke(
      new Api.channels.CreateChannel({ title, about: 'Files uploaded from Telecloud.', broadcast: true, megagroup: false })
    );
    const chats = 'chats' in created ? created.chats : [];
    channel = chats.find((c): c is Api.Channel => c instanceof Api.Channel) ?? null;
    if (!channel) throw new TelegramAuthError('Could not create the Telecloud storage channel.', 502);
  }
  // The access hash is what lets the channel be addressed directly later, so a
  // session without one is not worth saving.
  if (!channel.accessHash) throw new TelegramAuthError('Telegram did not return access to the storage channel.', 502);

  return {
    session: (client.session as sessions.StringSession).save(),
    userId: me.id.toString(),
    name,
    channelId: channel.id.toString(),
    accessHash: channel.accessHash.toString(),
  };
}

/**
 * Pull the stored document off a message using raw TL types. GramJS also exposes
 * a `.document` helper, but going through the media union is stable across
 * versions and keeps the narrowing explicit.
 */
function documentOf(message: Api.Message | undefined): Api.Document | null {
  const media = message?.media;
  if (!(media instanceof Api.MessageMediaDocument)) return null;
  return media.document instanceof Api.Document ? media.document : null;
}

/** A connected account, used for every file operation after linking. */
export class TelegramStorage {
  private client: TelegramClient | null = null;
  private connecting: Promise<TelegramClient> | null = null;

  constructor(private apiId: number, private apiHash: string, private session: Session) {}

  /** One shared connection, created lazily and reused across requests. */
  private async ready(): Promise<TelegramClient> {
    if (this.client?.connected) return this.client;
    this.connecting ??= (async () => {
      const client = await connect(this.apiId, this.apiHash, this.session.session);
      if (!(await client.isUserAuthorized())) {
        await client.disconnect().catch(() => {});
        throw new TelegramAuthError('This Telegram session has expired. Link the account again.', 401);
      }
      this.client = client;
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /**
   * Address the storage channel directly by id + access hash. Scanning the
   * dialog list would be simpler, but the channel sinks below any page limit as
   * soon as the account has more recent chats, and every upload would then fail.
   */
  private peerValue: Api.InputPeerChannel | null = null;

  private peer(): Api.InputPeerChannel {
    this.peerValue ??= new Api.InputPeerChannel({
      channelId: bigInt(this.session.channelId),
      accessHash: bigInt(this.session.accessHash),
    });
    return this.peerValue;
  }

  async verify(): Promise<{ account: string; channel: string }> {
    const client = await this.ready();
    try {
      const me = await client.getMe();
      if (!(me instanceof Api.User) || me.id.toString() !== this.session.userId) {
        throw new TelegramAuthError('This session belongs to a different Telegram account. Sign in again.', 401);
      }
      const result = await client.invoke(
        new Api.channels.GetChannels({ id: [new Api.InputChannel({
          channelId: bigInt(this.session.channelId),
          accessHash: bigInt(this.session.accessHash),
        })] })
      );
      const chats = 'chats' in result ? result.chats : [];
      const channel = chats.find((c): c is Api.Channel => c instanceof Api.Channel);
      if (!channel) throw new TelegramAuthError('The “Telecloud Storage” channel is missing from this account. Link the account again.', 404);
      return { account: this.session.name, channel: channel.title };
    } catch (error) {
      throw error instanceof TelegramAuthError ? error : friendly(error);
    }
  }

  /**
   * Upload a file from disk to Telegram. workers>1 sends parts in parallel,
   * which matters a great deal once files run to hundreds of megabytes.
   *
   * `mime` is deliberately not forwarded: GramJS's `sendFile` accepts no
   * mimeType and drops the key silently, so passing one only looked like it
   * worked. Telegram derives the document's type from the filename attribute
   * below, and Telecloud serves its own copies using the mime stored in SQLite.
   */
  async upload(filePath: string, name: string, size: number, mime: string) {
    const client = await this.ready();
    try {
      const message = await client.sendFile(this.peer(), {
        file: new CustomFile(name, size, filePath),
        caption: name,
        // Store the exact bytes: no photo downscaling, no re-encoding.
        forceDocument: true,
        workers: size > 8 * 1024 * 1024 ? 4 : 1,
        attributes: [new Api.DocumentAttributeFilename({ fileName: name })],
      });
      const document = documentOf(message);
      return { messageId: message.id, size: document ? Number(document.size) : size };
    } catch (error) {
      throw friendly(error);
    }
  }

  /** File references expire, so the message is re-fetched on every access. */
  private async document(messageId: number): Promise<Api.Document> {
    const client = await this.ready();
    const messages = await client.getMessages(this.peer(), { ids: [messageId] });
    const document = documentOf(messages[0]);
    if (!document) throw new TelegramAuthError('This file is no longer stored in Telegram.', 404);
    return document;
  }

  /**
   * Download a byte range as an async iterable, so Express can stream straight
   * to the client without ever holding a whole 2 GB file in memory.
   */
  async *download(messageId: number, start = 0, end?: number): AsyncGenerator<Buffer> {
    const client = await this.ready();
    const document = await this.document(messageId);
    const total = Number(document.size);
    const last = end === undefined ? total - 1 : Math.min(end, total - 1);
    if (start > last || total === 0) return;

    // Telegram only serves reads aligned to 4 KB, so the first chunk is trimmed.
    const aligned = Math.floor(start / ALIGN) * ALIGN;
    let skip = start - aligned;
    let remaining = last - start + 1;

    try {
      const chunks = client.iterDownload({
        file: new Api.InputDocumentFileLocation({
          id: document.id,
          accessHash: document.accessHash,
          fileReference: document.fileReference,
          thumbSize: '',
        }),
        // A raw file location carries no DC, so without this GramJS asks this
        // account's home DC first, eats a FILE_MIGRATE error, and reconnects —
        // once per read, which a seeking media player does constantly.
        dcId: document.dcId,
        offset: bigInt(aligned),
        requestSize: CHUNK,
      });
      for await (const chunk of chunks) {
        // GramJS yields Buffers; the cast avoids copying a 512 KB block per chunk.
        let buffer = chunk as Buffer;
        if (skip > 0) {
          if (skip >= buffer.length) {
            skip -= buffer.length;
            continue;
          }
          buffer = buffer.subarray(skip);
          skip = 0;
        }
        if (buffer.length > remaining) buffer = buffer.subarray(0, remaining);
        remaining -= buffer.length;
        yield buffer;
        if (remaining <= 0) return;
      }
      // The iterator ran dry before the requested range was served, which means
      // the stored size no longer matches the document. Fail loudly rather than
      // letting the caller end a response short of its Content-Length.
      if (remaining > 0) {
        throw new TelegramAuthError('This file is shorter than expected in Telegram. Upload it again.', 502);
      }
    } catch (error) {
      throw error instanceof TelegramAuthError ? error : friendly(error);
    }
  }

  async deleteFile(messageId: number) {
    const client = await this.ready();
    try {
      await client.deleteMessages(this.peer(), [messageId], { revoke: true });
    } catch (error) {
      // A file already gone from Telegram should not block removing its row.
      const raw = error instanceof Error ? error.message : String(error);
      if (!/MESSAGE_DELETE_FORBIDDEN|MESSAGE_ID_INVALID/.test(raw)) throw friendly(error);
    }
  }

  /** Captions are the only per-message text, so renaming edits the caption. */
  async renameFile(messageId: number, name: string) {
    const client = await this.ready();
    try {
      await client.editMessage(this.peer(), { message: messageId, text: name });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (!/MESSAGE_NOT_MODIFIED|MESSAGE_ID_INVALID/.test(raw)) throw friendly(error);
    }
  }

  async close() {
    await this.client?.disconnect().catch(() => {});
    this.client = null;
    this.peerValue = null;
  }
}
