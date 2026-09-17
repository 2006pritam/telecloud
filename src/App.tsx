import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  Download,
  Eye,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Palette,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, CANCELED, AUTH_EXPIRED, AUTH_CHANGED, notifyAuthChanged } from './api';
import type { Entry, Status, Toast, UploadItem } from './types';
import EntryCard, { cardMeta } from './components/EntryCard';
import ContextMenu, { type MenuItem } from './components/ContextMenu';
import Login from './components/Login';
import LinkTelegram from './components/LinkTelegram';
import Sidebar, { type View } from './components/Sidebar';
import Topbar, { type SortKey } from './components/Topbar';
import Toasts from './components/Toasts';
import UploadPanel from './components/UploadPanel';
import { ColorModal, ConfirmModal, MoveModal, NewFolderModal, PreviewModal, RenameModal, VaultModal } from './components/Modals';
import { formatBytes, pluralize } from './util';

type ModalState =
  | { kind: 'newFolder' }
  | { kind: 'rename'; entry: Entry }
  | { kind: 'color'; entry: Entry }
  | { kind: 'move'; entry: Entry }
  | { kind: 'preview'; entry: Entry }
  | { kind: 'vault' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      action: () => Promise<unknown> | unknown;
    }
  | null;

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('telecloud-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [view, setView] = useState<View>({ type: 'folder', id: null });
  const [sort, setSort] = useState<SortKey>('name');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const uploadChain = useRef(Promise.resolve());
  const sessionEpoch = useRef(0);
  const uploadAborts = useRef(new Map<string, () => void>());

  const resetWorkspace = useCallback(() => {
    sessionEpoch.current += 1;
    for (const abort of uploadAborts.current.values()) abort();
    uploadAborts.current.clear();
    uploadChain.current = Promise.resolve();
    setEntries([]);
    setUploads([]);
    setView({ type: 'folder', id: null });
    setQuery('');
    setModal(null);
    setMenu(null);
    setDragging(false);
    dragDepth.current = 0;
  }, []);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);

  const boot = useCallback(async () => {
    resetWorkspace();
    const epoch = sessionEpoch.current;
    setLoading(true);
    try {
      const nextStatus = await api.status();
      if (epoch !== sessionEpoch.current) return;
      setStatus(nextStatus);
      setLoadError('');
      if (nextStatus.authed) {
        const { entries: nextEntries } = await api.entries();
        if (epoch === sessionEpoch.current) setEntries(nextEntries);
      } else {
        setEntries([]);
      }
    } catch (err) {
      if (epoch === sessionEpoch.current) {
        setStatus(null);
        setLoadError(err instanceof Error ? err.message : 'Could not reach the server.');
      }
    } finally {
      if (epoch === sessionEpoch.current) setLoading(false);
    }
  }, [resetWorkspace]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    window.localStorage.setItem('telecloud-theme', theme);
  }, [theme]);

  useEffect(() => {
    void boot();
    const expired = () => { void boot(); };
    const changed = (event: StorageEvent) => { if (event.key === AUTH_CHANGED) void boot(); };
    window.addEventListener(AUTH_EXPIRED, expired);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(AUTH_EXPIRED, expired);
      window.removeEventListener('storage', changed);
      for (const abort of uploadAborts.current.values()) abort();
    };
  }, [boot]);

  const refresh = useCallback(async () => {
    const epoch = sessionEpoch.current;
    try {
      const { entries: nextEntries } = await api.entries();
      if (epoch === sessionEpoch.current) setEntries(nextEntries);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not refresh.', 'error');
    }
  }, [toast]);

  const needsLogin = status !== null && status.passwordProtected && !status.siteAuthed;

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.deleted_at || !entry.parent_id) continue;
      counts.set(entry.parent_id, (counts.get(entry.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const crumbs = useMemo(() => {
    if (view.type !== 'folder' || !view.id) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    const chain: Entry[] = [];
    let current = byId.get(view.id);
    while (current) {
      chain.unshift(current);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return chain;
  }, [entries, view]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items: Entry[];
    if (q) items = entries.filter((e) => !e.deleted_at && e.name.toLowerCase().includes(q));
    else if (view.type === 'folder') items = entries.filter((e) => !e.deleted_at && !e.vault && e.parent_id === view.id);
    else if (view.type === 'vault') items = entries.filter((e) => !e.deleted_at && e.vault && e.parent_id === null);
    else if (view.type === 'starred') items = entries.filter((e) => !e.deleted_at && e.starred);
    else items = entries.filter((e) => !!e.deleted_at && !e.trash_root);
    return [...items].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      if (sort === 'date') return b.updated_at.localeCompare(a.updated_at);
      if (sort === 'size') return b.size - a.size;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [entries, query, sort, view]);

  const foldersCount = visible.filter((e) => e.kind === 'folder').length;
  const filesCount = visible.filter((e) => e.kind === 'file').length;
  const hasTrash = entries.some((e) => !!e.deleted_at);
  const telegramMode = status?.mode === 'telegram';
  const searching = query.trim().length > 0;

  const openFolder = useCallback((id: string | null) => {
    setQuery('');
    setView({ type: 'folder', id });
  }, []);

  const openEntry = useCallback(
    (entry: Entry) => {
      if (entry.deleted_at) return;
      if (entry.kind === 'folder') openFolder(entry.id);
      else setModal({ kind: 'preview', entry });
    },
    [openFolder]
  );

  const uploadFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const epoch = sessionEpoch.current;
      const parentId = view.type === 'folder' ? view.id : null;
      const inVault = view.type === 'vault';
      const limit = status?.maxUploadBytes ?? Infinity;
      for (const file of list) {
        // Catch oversized files here rather than after a long doomed upload.
        if (file.size > limit) {
          toast(`${file.name} is larger than the ${formatBytes(limit)} limit.`, 'error');
          continue;
        }
        const id = crypto.randomUUID();
        setUploads((current) => [...current, { id, name: file.name, size: file.size, progress: 0, state: 'uploading' }]);
        uploadChain.current = uploadChain.current
          .then(async () => {
            if (epoch !== sessionEpoch.current) return;
            try {
              await api.upload(
                file,
                parentId,
                inVault,
                (percent) => setUploads((current) => current.map((u) => (u.id === id ? { ...u, progress: percent } : u))),
                (abort) => uploadAborts.current.set(id, abort)
              );
              if (epoch !== sessionEpoch.current) return;
              setUploads((current) => current.map((u) => (u.id === id ? { ...u, state: 'done', progress: 100 } : u)));
              setTimeout(() => setUploads((current) => current.filter((u) => u.id !== id)), 2600);
              await refresh();
            } catch (err) {
              if (epoch !== sessionEpoch.current) return;
              const message = err instanceof Error ? err.message : 'Upload failed.';
              if (message === CANCELED) {
                setUploads((current) => current.filter((u) => u.id !== id));
              } else {
                setUploads((current) => current.map((u) => (u.id === id ? { ...u, state: 'error', error: message } : u)));
                toast(`${file.name}: ${message}`, 'error');
                setTimeout(() => setUploads((current) => current.filter((u) => u.id !== id)), 7000);
              }
            } finally { uploadAborts.current.delete(id); }
          })
          .catch(() => {});
      }
    },
    [refresh, status, toast, view]
  );

  const guard = useCallback(
    async (action: () => Promise<unknown>, successMessage?: string) => {
      try {
        await action();
        await refresh();
        if (successMessage) toast(successMessage, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Something went wrong.', 'error');
      }
    },
    [refresh, toast]
  );

  const confirmTrash = useCallback(
    (entry: Entry) => {
      setModal({
        kind: 'confirm',
        title: `Move “${entry.name}” to trash?`,
        message:
          entry.kind === 'folder'
            ? 'Everything inside this folder will be moved to trash with it. You can restore it later.'
            : 'You can restore it from Trash later.',
        confirmLabel: 'Move to trash',
        danger: true,
        action: () => api.remove(entry.id),
      });
    },
    []
  );

  const confirmPermanent = useCallback(
    (entry: Entry) => {
      setModal({
        kind: 'confirm',
        title: `Delete “${entry.name}” forever?`,
        message: telegramMode
          ? 'This permanently removes it from Telecloud and from your Telegram account. This cannot be undone.'
          : 'This permanently removes it from Telecloud. This cannot be undone.',
        confirmLabel: 'Delete forever',
        danger: true,
        action: () => api.remove(entry.id, true),
      });
    },
    [telegramMode]
  );

  const openMenu = useCallback(
    (event: React.MouseEvent, entry: Entry) => {
      event.preventDefault();
      event.stopPropagation();
      const inTrash = view.type === 'trash' && !searching;
      const items: MenuItem[] = [];
      if (inTrash) {
        items.push({ icon: RotateCcw, label: 'Restore', onClick: () => void guard(() => api.restore(entry.id), `“${entry.name}” restored.`) });
        items.push({ icon: Trash2, label: 'Delete forever', danger: true, onClick: () => confirmPermanent(entry) });
      } else {
        if (entry.kind === 'file') {
          items.push({ icon: Eye, label: 'Preview', onClick: () => setModal({ kind: 'preview', entry }) });
          items.push({
            icon: Download,
            label: 'Download',
            onClick: () => {
              const link = document.createElement('a');
              link.href = api.downloadUrl(entry.id);
              link.download = entry.name;
              link.click();
            },
          });
        } else {
          items.push({ icon: FolderOpen, label: 'Open', onClick: () => openEntry(entry) });
        }
        items.push({ icon: Pencil, label: 'Rename', onClick: () => setModal({ kind: 'rename', entry }) });
        items.push({ icon: FolderInput, label: 'Move to…', onClick: () => setModal({ kind: 'move', entry }) });
        if (entry.kind === 'folder') {
          items.push({ icon: Palette, label: 'Change color', onClick: () => setModal({ kind: 'color', entry }) });
        }
        items.push({
          icon: entry.starred ? StarOff : Star,
          label: entry.starred ? 'Remove star' : 'Add star',
          onClick: () => void guard(() => api.patch(entry.id, { starred: !entry.starred })),
        });
        items.push({ icon: Trash2, label: 'Move to trash', danger: true, onClick: () => confirmTrash(entry) });
      }
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [confirmPermanent, confirmTrash, guard, openEntry, searching, view.type]
  );

  const renderModal = () => {
    if (!modal) return null;
    switch (modal.kind) {
      case 'newFolder':
        return (
          <NewFolderModal
            onClose={() => setModal(null)}
            onCreate={async (name, color) => {
              await api.createFolder(name, color, view.type === 'folder' ? view.id : null, view.type === 'vault');
              await refresh();
              toast(`Folder “${name}” created.`, 'success');
              setModal(null);
            }}
          />
        );
      case 'rename':
        return (
          <RenameModal
            entry={modal.entry}
            onClose={() => setModal(null)}
            onRename={async (name) => {
              await api.patch(modal.entry.id, { name });
              await refresh();
              setModal(null);
            }}
          />
        );
      case 'color':
        return (
          <ColorModal
            entry={modal.entry}
            onClose={() => setModal(null)}
            onPick={async (color) => {
              await api.patch(modal.entry.id, { color });
              await refresh();
              setModal(null);
            }}
          />
        );
      case 'move':
        return (
          <MoveModal
            entry={modal.entry}
            entries={entries}
            onClose={() => setModal(null)}
            onMove={async (parentId) => {
              await api.patch(modal.entry.id, { parentId });
              await refresh();
              toast('Moved.', 'success');
              setModal(null);
            }}
          />
        );
      case 'preview':
        return <PreviewModal entry={modal.entry} onClose={() => setModal(null)} />;
      case 'vault':
        return <VaultModal setup={!(status?.vaultConfigured ?? false)} onClose={() => setModal(null)} onSubmit={async (pin) => { if (status?.vaultConfigured) await api.vault.unlock(pin); else await api.vault.setup(pin); setModal(null); await boot(); setView({ type: 'vault' }); toast('Secret Vault unlocked.', 'success'); }} />;
      case 'confirm':
        return (
          <ConfirmModal
            title={modal.title}
            message={modal.message}
            confirmLabel={modal.confirmLabel}
            danger={modal.danger}
            onClose={() => setModal(null)}
            onConfirm={async () => {
              const epoch = sessionEpoch.current;
              try {
                await modal.action();
                if (epoch === sessionEpoch.current) await refresh();
                setModal(null);
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Something went wrong.', 'error');
              }
            }}
          />
        );
    }
  };

  const emptyState = () => {
    if (searching) {
      return { title: 'Nothing found', hint: `No items match “${query.trim()}”.` };
    }
    if (view.type === 'starred') return { title: 'No starred items', hint: 'Star the things you reach for most.' };
    if (view.type === 'trash') return { title: 'Trash is empty', hint: 'Deleted items will wait here until you empty it.' };
    if (view.type === 'folder' && view.id) return { title: 'This folder is quiet', hint: 'Drop files here or press Upload.' };
    if (entries.length === 0)
      return { title: 'A little space for everything', hint: 'Create your first folder or upload a file to get started.' };
    return { title: 'Nothing here yet', hint: 'Drop files here or press Upload.' };
  };

  if (loading) {
    return (
      <div className="splash">
        <div className="splash-mark">
          <Cloud size={40} strokeWidth={2} />
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="splash">
        <div className="splash-error">
          <p>{loadError || 'The server did not respond.'}</p>
          <button className="btn primary" onClick={() => void boot()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (needsLogin) {
    return <Login onDone={() => { notifyAuthChanged(); void boot(); }} />;
  }

  // Telegram is configured but no account is linked yet: nothing can be stored
  // until the user completes the phone-code flow.
  if (status && status.configured && !status.linked) {
    return <LinkTelegram onLinked={() => { notifyAuthChanged(); void boot(); }} />;
  }

  const state = emptyState();
  const title = searching ? 'Search' : view.type === 'starred' ? 'Starred' : view.type === 'trash' ? 'Trash' : view.type === 'vault' ? 'Secret Vault' : 'My Files';
  const showUpload = !searching && view.type !== 'trash' && (view.type !== 'vault' || status.vaultUnlocked);
  const showNewFolder = !searching && (view.type === 'folder' || view.type === 'vault') && (view.type !== 'vault' || status.vaultUnlocked);
  const canDropFiles = showUpload;

  return (
    <div className="shell">
      <Sidebar
        status={status}
        entries={entries}
        view={view}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
        onNavigate={(next) => {
          setQuery('');
          setView(next);
        }}
        onLogout={async () => {
          resetWorkspace();
          setLoading(true);
          try {
            await api.logout();
            notifyAuthChanged();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Sign out failed.', 'error');
          } finally {
            await boot();
          }
        }}
        onUnlink={() =>
          setModal({
            kind: 'confirm',
            title: 'Unlink this Telegram account?',
            message:
              'This signs your account out on all browsers using this Telecloud server. Your files and folders are kept, and you can sign in again at any time.',
            confirmLabel: 'Unlink',
            action: async () => {
              await api.telegram.unlink();
              notifyAuthChanged();
              await boot();
            },
          })
        }
        onVault={() => {
          if (status.vaultUnlocked) {
            void api.vault.lock().then(() => boot()).catch((err) => toast(err instanceof Error ? err.message : 'Could not lock the vault.', 'error'));
          } else setModal({ kind: 'vault' });
        }}
      />

      <main
        className="main"
        onDragEnter={(e) => {
          if (!canDropFiles || !Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (canDropFiles && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragging(true);
          }
        }}
        onDragLeave={() => {
          if (!canDropFiles) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (canDropFiles && e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        }}
      >
        <Topbar
          crumbs={crumbs}
          title={title}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          showUpload={showUpload}
          showNewFolder={showNewFolder}
          showEmptyTrash={!searching && view.type === 'trash'}
          hasTrash={hasTrash}
          onUpload={() => fileInput.current?.click()}
          onNewFolder={() => setModal({ kind: 'newFolder' })}
          onEmptyTrash={() =>
            setModal({
              kind: 'confirm',
              title: 'Empty the trash?',
              message: telegramMode
                ? 'Everything in Trash will be deleted forever, including the files stored in your Telegram account.'
                : 'Everything in Trash will be deleted forever.',
              confirmLabel: 'Empty trash',
              danger: true,
              action: () => api.purge(),
            })
          }
          onNavigate={openFolder}
        />

        {canDropFiles && <div className="drop-hint"><Upload size={14} /> Drop files anywhere here to upload</div>}

        {visible.length > 0 && (
          <div className="list-meta">
            {foldersCount > 0 && pluralize(foldersCount, 'folder')}
            {foldersCount > 0 && filesCount > 0 && ' · '}
            {filesCount > 0 && pluralize(filesCount, 'file')}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="empty">
            <div className="empty-art">
              <Cloud size={44} strokeWidth={1.6} />
            </div>
            <h3>{state.title}</h3>
            <p>{state.hint}</p>
            {view.type !== 'trash' && !searching && (
              <div className="empty-actions">
                <button className="btn primary" onClick={() => fileInput.current?.click()}>
                  <Upload size={15} />
                  Upload files
                </button>
                {showNewFolder && (
                  <button className="btn ghost" onClick={() => setModal({ kind: 'newFolder' })}>
                    <FolderPlus size={15} />
                    New folder
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid">
            {visible.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                meta={cardMeta(entry, childCounts.get(entry.id) ?? 0)}
                onOpen={() => openEntry(entry)}
                onToggleStar={() => void guard(() => api.patch(entry.id, { starred: !entry.starred }))}
                onMenu={(event) => openMenu(event, entry)}
              />
            ))}
          </div>
        )}

        {dragging && (
          <div className="drop-overlay">
            <div className="drop-card">
              <Upload size={26} />
              <span>Drop to upload</span>
            </div>
          </div>
        )}
      </main>

      <input
        ref={fileInput}
        id="file-input"
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {renderModal()}
      <UploadPanel uploads={uploads} onDismiss={(id) => setUploads((current) => current.filter((u) => u.id !== id))} />
      <Toasts toasts={toasts} />
    </div>
  );
}
