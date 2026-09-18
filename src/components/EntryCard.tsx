import { Folder, MoreHorizontal, Star } from 'lucide-react';
import type { Entry } from '../types';
import { fileVisual, folderColor, formatBytes, formatDate } from '../util';

type EntryCardProps = {
  entry: Entry;
  meta: string;
  layout?: 'grid' | 'list';
  onOpen: () => void;
  onToggleStar: () => void;
  onMenu: (event: React.MouseEvent) => void;
};

export default function EntryCard({ entry, meta, layout = 'grid', onOpen, onToggleStar, onMenu }: EntryCardProps) {
  const color = folderColor(entry.color);
  const visual = entry.kind === 'file' ? fileVisual(entry.mime, entry.name) : null;
  const tileStyle = visual ? { background: visual.tile, color: visual.fg } : { background: color.soft, color: color.hex };

  return (
    <div
      className={`card ${layout}${entry.deleted_at ? ' trashed' : ''}${entry.starred ? ' starred' : ''}`}
      onClick={onOpen}
      onContextMenu={onMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="card-tile" style={tileStyle}>
        {visual ? (
          <visual.Icon size={layout === 'list' ? 20 : 30} strokeWidth={1.7} />
        ) : (
          <Folder size={layout === 'list' ? 20 : 30} strokeWidth={1.9} fill={color.soft} />
        )}
      </div>
      <div className="card-body">
        <div className="card-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="card-meta">{meta}</div>
      </div>
      {layout === 'list' && (
        <div className="card-cols">
          <span className="card-col">{entry.kind === 'file' ? formatBytes(entry.size) : meta}</span>
          <span className="card-col">{formatDate(entry.updated_at)}</span>
        </div>
      )}
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {entry.kind === 'file' && (
          <button
            className={`icon-btn star${entry.starred ? ' on' : ''}`}
            onClick={onToggleStar}
            aria-label={entry.starred ? 'Remove star' : 'Add star'}
          >
            <Star size={15} fill={entry.starred ? 'currentColor' : 'none'} />
          </button>
        )}
        <button className="icon-btn" onClick={onMenu} aria-label="More actions">
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}

export function cardMeta(entry: Entry, childCount: number): string {
  if (entry.kind === 'folder') return childCount === 1 ? '1 item' : `${childCount} items`;
  return `${formatBytes(entry.size)} · ${formatDate(entry.updated_at)}`;
}
