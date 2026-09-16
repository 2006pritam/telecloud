import { Check, FileWarning, Loader2, X } from 'lucide-react';
import type { UploadItem } from '../types';
import { fileVisual } from '../util';

export default function UploadPanel({ uploads, onDismiss }: { uploads: UploadItem[]; onDismiss: (id: string) => void }) {
  if (uploads.length === 0) return null;
  return (
    <div className="upload-panel">
      {uploads.map((item) => {
        const visual = fileVisual('', item.name);
        return (
          <div className="upload-item" key={item.id}>
            <div className="upload-icon" style={{ background: visual.tile, color: visual.fg }}>
              <visual.Icon size={18} />
            </div>
            <div className="upload-info">
              <div className="upload-name" title={item.name}>
                {item.name}
              </div>
              <div className="upload-sub">
                {item.state === 'uploading' && (item.progress > 0 ? `${item.progress}%` : 'Starting…')}
                {item.state === 'done' && 'Uploaded'}
                {item.state === 'error' && (item.error ?? 'Failed')}
              </div>
              <div className={`upload-bar${item.state === 'error' ? ' error' : ''}`}>
                <div
                  className="upload-fill"
                  style={{ width: `${item.state === 'done' ? 100 : item.progress}%` }}
                />
              </div>
            </div>
            <div className="upload-state">
              {item.state === 'uploading' && <Loader2 size={15} className="spin dim" />}
              {item.state === 'done' && <Check size={15} className="ok" />}
              {item.state === 'error' && <FileWarning size={15} className="bad" />}
              <button className="icon-btn" onClick={() => onDismiss(item.id)} aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
