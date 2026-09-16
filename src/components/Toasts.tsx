import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { Toast } from '../types';

export default function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          {toast.kind === 'error' ? (
            <AlertCircle size={15} />
          ) : toast.kind === 'success' ? (
            <CheckCircle2 size={15} />
          ) : (
            <Info size={15} />
          )}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
