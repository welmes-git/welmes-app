import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

export default function Toast() {
  const { toast, clearToast } = useStore();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        clearToast();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast, clearToast]);

  if (!toast) return null;

  // White panel on the single shadow tier; only the icon carries signal color
  const icons = {
    success: <CheckCircle size={18} className="shrink-0 text-signal-ok" />,
    error: <XCircle size={18} className="shrink-0 text-signal-error" />,
    info: <Info size={18} className="shrink-0 text-ink-500" />,
  };

  return (
    <div className="fixed top-4 right-4 z-[100] animate-slideIn" role={toast.type === 'error' ? 'alert' : 'status'}>
      <div className="bg-canvas border border-line text-ink-900 px-4 py-3 rounded-[10px] shadow-hover flex items-center gap-3 min-w-[280px] max-w-[calc(100vw-2rem)]">
        {icons[toast.type]}
        <span className="text-[13px] font-medium flex-1">{toast.message}</span>
        <button
          onClick={clearToast}
          aria-label="Close"
          className="shrink-0 text-ink-500 hover:text-ink-900 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
