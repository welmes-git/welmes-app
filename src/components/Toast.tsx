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

  const icons = {
    success: <CheckCircle size={18} />,
    error: <XCircle size={18} />,
    info: <Info size={18} />,
  };

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-[#4a90e2]',
  };

  return (
    <div className="fixed top-4 right-4 z-[100] animate-slideIn">
      <div
        className={`${colors[toast.type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[280px]`}
      >
        {icons[toast.type]}
        <span className="text-[13px] font-medium flex-1">{toast.message}</span>
        <button
          onClick={clearToast}
          className="hover:opacity-70 transition-opacity"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
