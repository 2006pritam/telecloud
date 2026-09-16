import { Folder } from 'lucide-react';
import type { Entry } from '../types';
import { fileVisual, folderColor, formatBytes, formatDate } from '../util';

type EntryCardProps = {
  entry: Entry;
  meta: string;
  onOpen: () => void;
  onToggleStar: () => void;
  onMenu: (event: React.MouseEvent) => void;
};

export default function EntryCard({ entry, meta, onOpen, onToggleStar, onMenu }: EntryCardProps) {
  const color = folderColor(entry.color);

  return (
    <div className={`card${entry.deleted_at ? ' trashed' : ''}`} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      {entry.kind === 'folder' ? (
        <div className="card-tile" style={{ background: color.soft, color: color.hex }}>
          <Folder size={30} strokeWidth={1.9} fill={color.soft} />
        </div>
      ) : (
        (() => {
          const visual = fileVisual(entry.mime, entry.name);
          return (
            <div className="card-tile" style={{ background: visual.tile, color: visual.fg }}>
              <visual.Icon size={30} strokeWidth={1.7} />
            </div>
          );
        })()
      )}
      <div className="card-body">
        <div className="card-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="card-meta">{meta}</div>
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {entry.kind === 'file' && (
          <button
            className={`icon-btn star${entry.starred ? ' on' : ''}`}
            onClick={onToggleStar}
            aria-label={entry.starred ? 'Remove star' : 'Add star'}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill={entry.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
            </svg>
          </button>
        )}
        <button className="icon-btn" onClick={onMenu} aria-label="More actions">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function cardMeta(entry: Entry, childCount: number): string {
  if (entry.kind === 'folder') {
    const parts = [childCount === 1 ? '1 item' : `${childCount} items`];
    if (entry.starred) parts.push('starred');
    return parts.join(' · ');
  }
  const parts = [formatBytes(entry.size), formatDate(entry.updated_at)];
  if (entry.starred) parts.push('starred');
  return parts.join(' · ');
}
