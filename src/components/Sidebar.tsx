import { Cloud, FolderClosed, HardDrive, LockKeyhole, LogOut, ShieldCheck, Moon, Star, Sun, Trash2, UnlockKeyhole } from 'lucide-react';
import type { Entry, Status } from '../types';
import { formatBytes, pluralize } from '../util';

export type View = { type: 'folder'; id: string | null } | { type: 'starred' } | { type: 'trash' } | { type: 'vault' };

type SidebarProps = {
  status: Status;
  entries: Entry[];
  view: View;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigate: (view: View) => void;
  onLogout: () => void;
  onUnlink: () => void;
  onVault: () => void;
};

export default function Sidebar({ status, entries, view, theme, onToggleTheme, onNavigate, onLogout, onUnlink, onVault }: SidebarProps) {
  const files = entries.filter((e) => !e.deleted_at && e.kind === 'file');
  const usedBytes = files.reduce((sum, f) => sum + f.size, 0);
  const isFolderView = view.type === 'folder';

  const navItem = (active: boolean) => `nav-item${active ? ' active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Cloud size={22} strokeWidth={2.4} />
        </div>
        <div className="brand-text">
          <span className="brand-name">Telecloud</span>
          <span className="brand-tag">A little space for everything</span>
        </div>
      </div>

      <button className="theme-toggle sidebar-theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
        {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
      </button>

      <nav className="nav">
        <button className={navItem(isFolderView)} onClick={() => onNavigate({ type: 'folder', id: null })}>
          <FolderClosed size={18} />
          <span>My Files</span>
        </button>
        <button className={navItem(view.type === 'starred')} onClick={() => onNavigate({ type: 'starred' })}>
          <Star size={18} />
          <span>Starred</span>
        </button>
        <button className={navItem(view.type === 'trash')} onClick={() => onNavigate({ type: 'trash' })}>
          <Trash2 size={18} />
          <span>Trash</span>
        </button>
        <button className={navItem(view.type === 'vault')} onClick={onVault}>
          {status.vaultUnlocked ? <UnlockKeyhole size={18} /> : <LockKeyhole size={18} />}
          <span>Secret Vault</span>
          <span className="nav-badge">{status.vaultUnlocked ? 'Open' : status.vaultConfigured ? 'Locked' : 'Set up'}</span>
        </button>
      </nav>

      <div className="sidebar-foot">
        <div className={`mode-card ${status.mode}`}>
          <span className="mode-dot" />
          <div className="mode-text">
            {status.mode === 'telegram' && status.telegram ? (
              <>
                <span className="mode-title">Telegram storage</span>
                <span className="mode-sub">
                  {status.telegram.account} · {status.telegram.channel}
                </span>
                <button className="mode-action" onClick={onUnlink}>
                  Unlink account
                </button>
              </>
            ) : (
              <>
                <span className="mode-title">{status.mode === 'telegram' ? 'Not linked' : 'Local demo'}</span>
                <span className="mode-sub">
                  {status.mode === 'telegram' ? 'Link a Telegram account to store files' : 'Files stay on this computer'}
                </span>
                {/* Demo and Telegram storage look alike, so say why this is the
                    demo rather than leaving it to look like a failed link. */}
                {status.setupHint && <span className="mode-hint">{status.setupHint}</span>}
              </>
            )}
          </div>
        </div>

        <div className="storage-card">
          <HardDrive size={16} />
          <span>
            {pluralize(files.length, 'file')} · {formatBytes(usedBytes)}
          </span>
        </div>

        {status.vaultUnlocked && (
          <button className="btn ghost block" onClick={onVault}>
            <ShieldCheck size={15} />
            Lock vault
          </button>
        )}

        {(status.passwordProtected || status.linked) && (
          <button className="btn ghost block" onClick={onLogout}>
            <LogOut size={15} />
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
