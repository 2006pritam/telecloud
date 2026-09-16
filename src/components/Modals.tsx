import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Download,
  FileQuestion,
  Folder,
  FolderInput,
  Home,
  Loader2,
  Palette,
  Pencil,
  X,
} from 'lucide-react';
import type { Entry } from '../types';
import { api, } from '../api';
import { FOLDER_COLORS, folderColor, formatBytes, previewKind } from '../util';

function Modal({
  title,
  icon,
  onClose,
  children,
  wide,
}: {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {icon}
            {title}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NewFolderModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, color: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(FOLDER_COLORS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim(), color);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the folder.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New folder" icon={<Folder size={17} />} onClose={onClose}>
      <label className="field">
        <Pencil size={15} />
        <input
          value={name}
          placeholder="Folder name"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      <div className="swatches">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c.id}
            className={`swatch${color === c.id ? ' on' : ''}`}
            style={{ background: c.hex }}
            onClick={() => setColor(c.id)}
            aria-label={c.id}
          >
            {color === c.id && <Check size={13} color="#fff" />}
          </button>
        ))}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={busy || !name.trim()}>
          {busy && <Loader2 size={15} className="spin" />}
          Create folder
        </button>
      </div>
    </Modal>
  );
}

export function RenameModal({
  entry,
  onRename,
  onClose,
}: {
  entry: Entry;
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onRename(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename.');
      setBusy(false);
    }
  };

  return (
    <Modal title={`Rename “${entry.name}”`} onClose={onClose}>
      <label className="field">
        <Pencil size={15} />
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={busy || !name.trim()}>
          {busy && <Loader2 size={15} className="spin" />}
          Save
        </button>
      </div>
    </Modal>
  );
}

export function ColorModal({
  entry,
  onPick,
  onClose,
}: {
  entry: Entry;
  onPick: (color: string) => Promise<void>;
  onClose: () => void;
}) {
  const [color, setColor] = useState(entry.color);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onPick(color);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Color for “${entry.name}”`} icon={<Palette size={16} />} onClose={onClose}>
      <div className="swatches big">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c.id}
            className={`swatch${color === c.id ? ' on' : ''}`}
            style={{ background: c.hex }}
            onClick={() => setColor(c.id)}
            aria-label={c.id}
          >
            {color === c.id && <Check size={14} color="#fff" />}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 size={15} className="spin" />}
          Save color
        </button>
      </div>
    </Modal>
  );
}

export function MoveModal({
  entry,
  entries,
  onMove,
  onClose,
}: {
  entry: Entry;
  entries: Entry[];
  onMove: (parentId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(entry.parent_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const folders = useMemo(
    () => entries.filter((e) => e.kind === 'folder' && !e.deleted_at && e.id !== entry.id),
    [entries, entry.id]
  );
  const excluded = useMemo(() => {
    if (entry.kind !== 'folder') return new Set<string>();
    return new Set([entry.id, ...collectDescendants(entries, entry.id)]);
  }, [entries, entry]);
  const rows = buildTreeRows(folders, excluded);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onMove(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move.');
      setBusy(false);
    }
  };

  return (
    <Modal title={`Move “${entry.name}”`} icon={<FolderInput size={16} />} onClose={onClose}>
      <div className="move-list">
        <button className={`move-row${target === null ? ' selected' : ''}`} onClick={() => setTarget(null)}>
          <Home size={16} />
          <span>My Files</span>
        </button>
        {rows.map((folder) => (
          <button
            key={folder.id}
            className={`move-row${target === folder.id ? ' selected' : ''}`}
            style={{ paddingLeft: 14 + folder.depth * 18 }}
            onClick={() => setTarget(folder.id)}
          >
            <Folder size={16} style={{ color: folderColor(folder.color).hex }} />
            <span>{folder.name}</span>
          </button>
        ))}
        {rows.length === 0 && <div className="move-empty">No folders yet.</div>}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={busy || target === entry.parent_id}>
          {busy && <Loader2 size={15} className="spin" />}
          Move here
        </button>
      </div>
    </Modal>
  );
}

function collectDescendants(entries: Entry[], rootId: string): string[] {
  const ids: string[] = [];
  const walk = (parentId: string) => {
    for (const e of entries) {
      if (e.parent_id === parentId) {
        ids.push(e.id);
        walk(e.id);
      }
    }
  };
  walk(rootId);
  return ids;
}

function buildTreeRows(folders: Entry[], excluded: Set<string>) {
  const rows: { id: string; name: string; color: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of folders) {
      if (excluded.has(folder.id) || folder.parent_id !== parentId) continue;
      rows.push({ id: folder.id, name: folder.name, color: folder.color, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={submit} disabled={busy}>
          {busy && <Loader2 size={15} className="spin" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PreviewModal({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const kind = previewKind(entry.mime);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (kind === 'text' && entry.size < 4 * 1024 * 1024) {
      fetch(api.rawUrl(entry.id))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error('failed'))))
        .then((body) => alive && setText(body))
        .catch(() => alive && setFailed(true));
    }
    return () => {
      alive = false;
    };
  }, [entry.id, entry.size, kind]);

  return (
    <Modal title={entry.name} onClose={onClose} wide>
      <div className="preview-meta">
        {formatBytes(entry.size)} · {entry.mime || 'file'}
      </div>
      <div className="preview-body">
        {kind === 'image' && <img src={api.rawUrl(entry.id)} alt={entry.name} />}
        {kind === 'video' && <video src={api.rawUrl(entry.id)} controls autoPlay />}
        {kind === 'audio' && <audio src={api.rawUrl(entry.id)} controls autoPlay />}
        {kind === 'pdf' && <iframe src={api.rawUrl(entry.id)} title={entry.name} />}
        {kind === 'text' &&
          (text !== null ? <pre>{text}</pre> : failed ? <PreviewFallback /> : <Loader2 size={22} className="spin dim" />)}
        {!kind && <PreviewFallback />}
      </div>
      <div className="modal-actions">
        <a className="btn primary" href={api.downloadUrl(entry.id)} download={entry.name}>
          <Download size={15} />
          Download
        </a>
      </div>
    </Modal>
  );
}

function PreviewFallback() {
  return (
    <div className="preview-fallback">
      <FileQuestion size={34} />
      <p>No preview for this file type</p>
    </div>
  );
}
