import { useMemo } from 'react';
import { Cloud, FolderClosed, LockKeyhole, LogOut, Moon, ShieldCheck, Star, Sun, Trash2, UnlockKeyhole } from 'lucide-react';
import type { Entry, Status } from '../types';
import { FILE_CATEGORIES, fileCategory, formatBytes, pluralize, type FileCategory } from '../util';

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
  const isFolderView = view.type === 'folder';

  const live = useMemo(() => entries.filter((e) => !e.deleted_at), [entries]);
  const starredCount = live.filter((e) => e.starred).length;
  const trashCount = entries.filter((e) => !!e.deleted_at && !e.trash_root).length;

  const storage = useMemo(() => {
    const files = live.filter((e) => e.kind === 'file');
    const bytes: Record<FileCategory, number> = { images: 0, media: 0, docs: 0, other: 0 };
    let total = 0;
    for (const file of files) {
      bytes[fileCategory(file.mime, file.name)] += file.size;
      total += file.size;
    }
    return { count: files.length, total, bytes };
  }, [live]);

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
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>

      <nav className="nav" aria-label="Sections">
        <span className="nav-heading">Browse</span>
        <button className={navItem(isFolderView)} onClick={() => onNavigate({ type: 'folder', id: null })}>
          <FolderClosed size={18} />
          <span>My Files</span>
        </button>
        <button className={navItem(view.type === 'starred')} onClick={() => onNavigate({ type: 'starred' })}>
          <Star size={18} />
          <span>Starred</span>
          {starredCount > 0 && <span className="nav-count">{starredCount}</span>}
        </button>
        <button className={navItem(view.type === 'trash')} onClick={() => onNavigate({ type: 'trash' })}>
          <Trash2 size={18} />
          <span>Trash</span>
          {trashCount > 0 && <span className="nav-count">{trashCount}</span>}
        </button>

        <span className="nav-heading">Private</span>
        <button className={navItem(view.type === 'vault')} onClick={onVault}>
          {status.vaultUnlocked ? <UnlockKeyhole size={18} /> : <LockKeyhole size={18} />}
          <span>Secret Vault</span>
          <span className={`nav-badge${status.vaultUnlocked ? ' open' : ''}`}>
            {status.vaultUnlocked ? 'Open' : status.vaultConfigured ? 'Locked' : 'Set up'}
          </span>
        </button>
      </nav>

      <div className="sidebar-foot">
        <section className="storage-card" aria-label="Storage breakdown">
          <div className="storage-head">
            <span className="storage-title">Storage</span>
            <span className="storage-total">{formatBytes(storage.total)}</span>
          </div>
          <div className="storage-bar" role="img" aria-label={`${formatBytes(storage.total)} across ${pluralize(storage.count, 'file')}`}>
            {storage.total > 0 ? (
              FILE_CATEGORIES.map((cat) =>
                storage.bytes[cat.id] > 0 ? (
                  <span
                    key={cat.id}
                    className={`storage-seg ${cat.id}`}
                    style={{ flexGrow: storage.bytes[cat.id] }}
                    title={`${cat.label} · ${formatBytes(storage.bytes[cat.id])}`}
                  />
                ) : null
              )
            ) : (
              <span className="storage-seg empty" />
            )}
          </div>
          <ul className="storage-legend">
            {FILE_CATEGORIES.map((cat) => (
              <li key={cat.id}>
                <span className={`legend-dot ${cat.id}`} />
                <span className="legend-label">{cat.label}</span>
                <span className="legend-value">{formatBytes(storage.bytes[cat.id])}</span>
              </li>
            ))}
          </ul>
          <div className="storage-foot">{pluralize(storage.count, 'file')} stored</div>
        </section>

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

        {(status.vaultUnlocked || status.passwordProtected || status.linked) && (
          <div className="sidebar-actions">
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
        )}
      </div>
    </aside>
  );
}
