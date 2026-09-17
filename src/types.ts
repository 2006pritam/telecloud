export type Entry = {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  parent_id: string | null;
  mime: string;
  size: number;
  color: string;
  starred: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  trash_root: string | null;
  vault: boolean;
};

export type Status = {
  passwordProtected: boolean;
  /** Optional site password has been accepted; Telegram login is separate. */
  siteAuthed: boolean;
  authed: boolean;
  mode: 'demo' | 'telegram';
  /** TELEGRAM_API_ID / TELEGRAM_API_HASH are set on the server. */
  configured: boolean;
  /** Why Telegram storage is off, when it is. Null once it is configured. */
  setupHint: string | null;
  /** This browser has signed in with its own Telegram account. */
  linked: boolean;
  telegram: { account: string; channel: string } | null;
  maxUploadBytes: number;
  vaultConfigured: boolean;
  vaultUnlocked: boolean;
};

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  progress: number;
  state: 'uploading' | 'done' | 'error';
  error?: string;
};

export type Toast = {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'error';
};
