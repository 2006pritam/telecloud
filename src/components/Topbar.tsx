import { ChevronRight, FolderPlus, Moon, Search, Sun, Trash2, Upload, X } from 'lucide-react';
import type { Entry } from '../types';

export type SortKey = 'name' | 'date' | 'size';

type TopbarProps = {
  crumbs: Entry[];
  title: string;
  query: string;
  onQuery: (value: string) => void;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  showUpload: boolean;
  showNewFolder: boolean;
  showEmptyTrash: boolean;
  hasTrash: boolean;
  onUpload: () => void;
  onNewFolder: () => void;
  onEmptyTrash: () => void;
  onNavigate: (folderId: string | null) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
};

export default function Topbar({
  crumbs,
  title,
  query,
  onQuery,
  sort,
  onSort,
  showUpload,
  showNewFolder,
  showEmptyTrash,
  hasTrash,
  onUpload,
  onNewFolder,
  onEmptyTrash,
  onNavigate,
  theme,
  onToggleTheme,
}: TopbarProps) {
  return (
    <header className="topbar">
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

      <div className="topbar-actions">
        <button className="theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
        </button>

        <label className="search">
          <Search size={15} />
          <input
            value={query}
            placeholder="Search files…"
            onChange={(e) => onQuery(e.target.value)}
          />
          {query && (
            <button className="clear" onClick={() => onQuery('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>

        <select className="sort" value={sort} onChange={(e) => onSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="name">Name</option>
          <option value="date">Date</option>
          <option value="size">Size</option>
        </select>

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
