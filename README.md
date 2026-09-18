# Telecloud

A little space for everything — a personal cloud drive that stores your files in your own Telegram account.

Telecloud puts a friendly drive on top of Telegram: folders, stars, previews, trash, search, and drag-and-drop uploads. Your files themselves live in a private **Telecloud Storage** channel inside your Telegram account, so you can browse them from any Telegram client and take them with you.

Folders are an app concept, not a Telegram one — they live in a small local database, so they nest freely, rename instantly, and cost nothing to create.

Run it without Telegram credentials for a fully functional local demo.

## Quick start (local demo)

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. Files are stored on this computer under `data/demo`.

## Connect Telegram storage

Telecloud talks to Telegram over MTProto as a **user account**, not a bot. That is what raises the per-file ceiling from 50 MB to **2 GB**, and it means the files land in storage you already control.

1. **Get API credentials.** Visit [my.telegram.org](https://my.telegram.org) → *API development tools*, create an app, and copy the **api_id** and **api_hash**. These identify the app, not your account.

2. **Configure Telecloud.** Copy `.env.example` to `.env` and fill in:

   ```env
   TELEGRAM_API_ID=1234567
   TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
   ```

3. **Restart** with `npm run dev`. The app now shows **Sign in with Telegram** to each visitor. Configure these API credentials once for the application; users do not need their own API ID or hash.

4. **Sign in with your own account.** Enter your phone number in international format (`+15551234567`), then the login code Telegram sends you. If you have two-step verification enabled, you will be asked for that password too. Multiple people can sign in at the same time without sharing login attempts or files.

5. Telecloud creates a private **Telecloud Storage** channel in your account and uploads there from then on. Your browser stays signed in for seven days, including across server restarts. Signing in to the same Telegram account again restores your folders and files.

Use **Sign out** to leave this browser or switch accounts. **Unlink account** removes Telecloud's saved Telegram connection and signs that account out of all browsers on this server. Other users keep their own connections. Neither action deletes files or folder metadata.

From now on:

- **New folder** → a row in the local database, created instantly, nestable at any depth
- **Upload** → streamed from the browser, through the server, into your Telegram channel
- **Rename** → updates the app label and the message caption in Telegram
- **Move** → a metadata change only; the file never leaves its channel
- **Delete** → moves to Trash; *deleting forever* also removes it from Telegram
- Open the **Telecloud Storage** channel in Telegram anytime to see the raw files

### Telegram limits

| | |
| --- | --- |
| File size | 2 GB per file (4 GB on a Premium account, which the app does not currently use) |
| Uploads | Free accounts are rate limited; large or numerous uploads can trigger a wait |
| Chats | The account must be able to post in the storage channel — it created it, so it can |

Because uploads act as your account, stay well inside normal use. Bulk mirroring another drive into Telegram is the kind of thing that gets an account flagged; using it as your own file cabinet is not.

## Security

Telecloud binds to `127.0.0.1` by default. In Telegram mode, every drive API requires a browser session tied to a verified Telegram user. Account names, file listings, previews, uploads, and file operations are scoped to that user. Anonymous visitors cannot use the owner's saved Telegram connection.

For a public deployment behind an HTTPS reverse proxy, set these in `.env`:

```env
APP_PASSWORD=                          # blank allows anyone to sign in with Telegram
SESSION_SECRET=long-random-string      # optional additional session hashing key
HOST=0.0.0.0
COOKIE_SECURE=true
TRUST_PROXY=1                         # only when there is exactly one trusted proxy
```

`APP_PASSWORD` is an optional extra gate before Telegram sign-in. Leave it blank for open registration. In local demo mode, there is no Telegram authentication and the demo workspace is shared; set a site password if exposing that demo.

Cookies contain random opaque tokens, never Telegram credentials. Only token hashes are stored in the session database. Cookies are `httpOnly` and `sameSite=lax`; `COOKIE_SECURE=true` requires HTTPS. Signing out invalidates the token on the server. Keep `SESSION_SECRET` stable across restarts; changing it invalidates existing browser cookies. Without an explicit secret, changing `APP_PASSWORD` also invalidates cookies.

**Treat the `data/` directory as a secret.** Account databases contain Telegram session strings that grant access to those accounts. Telegram sessions remain on the server; passwords and login codes are not persisted. The server operator must protect the data directory and its backups. Users can revoke Telecloud's Telegram session from Telegram's **Settings → Devices**.

## Production build

```bash
npm run build
npm start
```

This compiles the frontend to `dist/`, the API to `dist-server/`, and serves everything from one Express process on `PORT` (default 3001).

For a real deployment, use HTTPS (Caddy, nginx, or a tunnel) and `COOKIE_SECURE=true`. Preserve the original `Host` header at the proxy. Configure `TRUST_PROXY` for your actual proxy topology so login rate limits use client IP addresses.

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | API + Vite dev servers with hot reload        |
| `npm run build`     | Type-check and build frontend and server      |
| `npm start`         | Run the production build                      |
| `npm test`          | Demo and multi-user Telegram API integration tests |
| `npm run test:e2e`  | Playwright browser tests (run `npm run build` and `npx playwright install chromium` first) |
| `npm run check`     | TypeScript checks only                        |

## Data & backups

- Set `DATABASE_URL` to the Neon PostgreSQL connection string in Render. Telecloud mirrors each account's folders, entry metadata, vault settings, and Telegram session/channel metadata there, so a Render restart can rebuild the local cache. The actual file bytes remain in Telegram.

- `data/users/<telegram-user-id>/telegram/` holds each account's metadata database and Telegram session. `data/sessions.sqlite` holds hashed browser sessions. `data/demo/` holds the separate shared demo database and file blobs.
- In Telegram mode the files themselves live in your Telegram account: yours, portable, and reachable from any Telegram client.
- One `DATA_DIR` supports multiple Telegram accounts. Users sharing an account see the same file tree; different Telegram accounts have separate databases and connections.
- Existing installations keep their original `data/telegram/` database. The original owner must sign in again to access it; other users cannot inherit that session. Its recorded Telegram user ID identifies its owner. Legacy databases without any recorded owner are left untouched.
- Revoked Telegram sessions return users to sign-in when Telegram rejects an operation. Folder metadata stays intact. Restore a missing storage channel before reconnecting if it still holds your files.

Tests use a simulated Telegram service to verify login, two-step verification, account isolation, file access, sign-out, and restart behavior without sending real login codes. A live Telegram account is needed to check delivery and transfers against Telegram itself.

## How it fits together

```
browser ──► Express ──► SQLite        (folders, names, sizes, message IDs)
                 └───► MTProto ──► your private Telegram channel  (the bytes)
```

Nothing is duplicated: Telegram stores the file, SQLite stores the tree. That is why moving and renaming are instant regardless of file size, and why a 2 GB upload never passes through a buffer in server memory — uploads stream to a temp file and downloads stream back out in 512 KB chunks.
# telecloud
