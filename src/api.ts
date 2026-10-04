import type { Entry, Status } from './types';

export const CANCELED = '__canceled__';
export const AUTH_EXPIRED = 'telecloud:auth-expired';
export const AUTH_CHANGED = 'telecloud:auth-changed';

// On Cloudflare Pages (*.pages.dev), default to relative '' so requests route through
// Cloudflare Pages Functions and _redirects proxy, eliminating cross-origin CORS errors.
// VITE_API_BASE_URL still overrides it per environment.
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : (typeof window !== 'undefined' && window.location.hostname.endsWith('pages.dev')
        ? ''
        : 'https://telecloud-xkas.onrender.com')
).replace(/\/$/, '');

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export function notifyAuthChanged() {
  // Notify other tabs without storing any account credentials in localStorage.
  try { localStorage.setItem(AUTH_CHANGED, crypto.randomUUID()); } catch { /* Storage may be disabled. */ }
}

async function req<T>(url: string, init?: RequestInit, retries = 2): Promise<T> {
  const target = apiUrl(url);
  try {
    const res = await fetch(target, {
      ...init,
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      if (res.status === 401 && !url.startsWith('/api/auth/') && !url.startsWith('/api/telegram/')) {
        window.dispatchEvent(new Event(AUTH_EXPIRED));
      }
      throw new Error(data.error || `Request failed (${res.status}).`);
    }
    return data;
  } catch (err) {
    if (retries > 0 && (!init?.method || init.method === 'GET')) {
      await new Promise((r) => setTimeout(r, 1500));
      return req<T>(url, init, retries - 1);
    }
    throw err;
  }
}

export const api = {
  status: () => req<Status>('/api/auth/status'),
  login: (password: string, turnstileToken?: string) =>
    req<{ ok: true }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password, ...(turnstileToken ? { turnstileToken } : {}) }),
    }),
  logout: () => req<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  telegram: {
    qrStart: () =>
      req<{ qrToken: string; expiresAt: number }>('/api/telegram/qr/start', { method: 'POST' }),
    qrPoll: () =>
      req<{ step: 'pending'; token: string; expiresAt: number } | { step: 'done'; telegram: Status['telegram'] }>(
        '/api/telegram/qr/poll'
      ),
    sendCode: (phone: string, turnstileToken?: string) =>
      req<{ step: 'code' }>('/api/telegram/send-code', {
        method: 'POST',
        body: JSON.stringify({ phone, ...(turnstileToken ? { turnstileToken } : {}) }),
      }),
    signIn: (code: string) =>
      req<{ step: 'password'; hint?: string } | { step: 'done'; telegram: Status['telegram'] }>(
        '/api/telegram/sign-in',
        { method: 'POST', body: JSON.stringify({ code }) }
      ),
    password: (password: string) =>
      req<{ step: 'done'; telegram: Status['telegram'] }>('/api/telegram/password', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    unlink: () => req<{ ok: true }>('/api/telegram/unlink', { method: 'POST' }),
  },
  vault: {
    unlock: (pin: string) =>
      req<{ ok: true; vaultConfigured: true; vaultUnlocked: true }>('/api/vault/unlock', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      }),
    lock: () => req<{ ok: true; vaultUnlocked: false }>('/api/vault/lock', { method: 'POST' }),
  },
  entries: () => req<{ entries: Entry[] }>('/api/entries'),
  createFolder: (name: string, color: string, parentId: string | null) =>
    req<{ entry: Entry }>('/api/folders', { method: 'POST', body: JSON.stringify({ name, color, parentId }) }),
  patch: (id: string, patch: Record<string, unknown>) =>
    req<{ entry: Entry }>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: string, permanent = false) =>
    req<{ ok: true }>(`/api/entries/${id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' }),
  restore: (id: string) => req<{ entry: Entry }>(`/api/entries/${id}/restore`, { method: 'POST' }),
  purge: () => req<{ ok: true }>('/api/trash/purge', { method: 'POST' }),
  downloadUrl: (id: string) => apiUrl(`/api/files/${id}/download`),
  rawUrl: (id: string) => apiUrl(`/api/files/${id}/raw`),
  upload(
    file: File,
    parentId: string | null,
    onProgress: (percent: number) => void,
    onRegister?: (abort: () => void) => void
  ): Promise<Entry> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      if (parentId) form.append('parentId', parentId);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/api/files'));
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
        try {
          const data = JSON.parse(xhr.responseText) as { entry?: Entry; error?: string };
          if (xhr.status >= 200 && xhr.status < 300 && data.entry) resolve(data.entry);
          else reject(new Error(data.error || 'Upload failed.'));
        } catch {
          reject(new Error('Upload failed.'));
        }
      };
      xhr.onabort = () => reject(new Error(CANCELED));
      xhr.onerror = () => reject(new Error('The upload could not reach the server.'));
      onRegister?.(() => xhr.abort());
      xhr.send(form);
    });
  },
};
