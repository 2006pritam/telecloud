import { ArrowDownAZ, CalendarClock, ChevronRight, FolderPlus, HardDrive, LayoutGrid, List, Search, Trash2, Upload, X } from 'lucide-react';
import type { Entry } from '../types';

export type SortKey = 'name' | 'date' | 'size';
export type Layout = 'grid' | 'list';

const SORTS: { id: SortKey; label: string; Icon: typeof ArrowDownAZ }[] = [
  { id: 'name', label: 'Name', Icon: ArrowDownAZ },
  { id: 'date', label: 'Date', Icon: CalendarClock },
  { id: 'size', label: 'Size', Icon: HardDrive },
];

type TopbarProps = {
  crumbs: Entry[];
  title: string;
  subtitle: string;
  query: string;
  onQuery: (value: string) => void;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  layout: Layout;
  onLayout: (value: Layout) => void;
  showUpload: boolean;
  showNewFolder: boolean;
  showEmptyTrash: boolean;
  hasTrash: boolean;
  onUpload: () => void;
  onNewFolder: () => void;
  onEmptyTrash: () => void;
  onNavigate: (folderId: string | null) => void;
};

export default function Topbar({
  crumbs,
  title,
  subtitle,
  query,
  onQuery,
  sort,
  onSort,
  layout,
  onLayout,
  showUpload,
  showNewFolder,
  showEmptyTrash,
  hasTrash,
  onUpload,
  onNewFolder,
  onEmptyTrash,
  onNavigate,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-lead">
        <div className="crumbs">
          {crumbs.length > 0 ? (
            <>
              <button className="crumb root" onClick={() => onNavigate(null)}>
                My Files
              </button>
              {crumbs.map((crumb, index) => (
                <span className="crumb-step" key={crumb.id}>
                  <ChevronRight size={14} />
                  {index === crumbs.length - 1 ? (
                    <span className="crumb current">{crumb.name}</span>
                  ) : (
                    <button className="crumb" onClick={() => onNavigate(crumb.id)}>
                      {crumb.name}
                    </button>
                  )}
                </span>
              ))}
            </>
          ) : (
            <h2 className="view-title">{title}</h2>
          )}
        </div>
        {subtitle && <p className="view-sub">{subtitle}</p>}
      </div>

      <div className="topbar-actions">
        <label className="search">
          <Search size={15} />
          <input value={query} placeholder="Search files…" onChange={(e) => onQuery(e.target.value)} />
          {query && (
            <button className="clear" onClick={() => onQuery('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>

        <div className="segmented" role="group" aria-label="Sort by">
          {SORTS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`seg${sort === id ? ' on' : ''}`}
              onClick={() => onSort(id)}
              aria-pressed={sort === id}
              title={`Sort by ${label.toLowerCase()}`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="segmented compact" role="group" aria-label="Layout">
          <button
            className={`seg${layout === 'grid' ? ' on' : ''}`}
            onClick={() => onLayout('grid')}
            aria-pressed={layout === 'grid'}
            aria-label="Grid view"
            title="Grid view"
          >
            <LayoutGrid size={15} />
          </button>
          <button
            className={`seg${layout === 'list' ? ' on' : ''}`}
            onClick={() => onLayout('list')}
            aria-pressed={layout === 'list'}
            aria-label="List view"
            title="List view"
          >
            <List size={15} />
          </button>
        </div>

        {showEmptyTrash && (
          <button className="btn danger-ghost" onClick={onEmptyTrash} disabled={!hasTrash}>
            <Trash2 size={15} />
            Empty trash
          </button>
        )}
        {showNewFolder && (
          <button className="btn ghost" onClick={onNewFolder}>
            <FolderPlus size={15} />
            New folder
          </button>
        )}
        {showUpload && (
          <button className="btn primary" onClick={onUpload}>
            <Upload size={15} />
            Upload
          </button>
        )}
      </div>
    </header>
  );
}
