import {
  useState,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import { ToastContext, type ToastType, type Toast, type ConfirmOptions, type ToastContextValue } from './toastContextTypes';

const toastStyles: Record<ToastType, { bg: string; border: string; icon: ReactNode }> = {
  success: {
    bg: 'bg-green-50',
    border: 'border-green-400',
    icon: <CheckCircle className="w-5 h-5 text-green-600" />,
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-400',
    icon: <AlertCircle className="w-5 h-5 text-red-600" />,
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-400',
    icon: <Info className="w-5 h-5 text-blue-600" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const idCounter = useRef(0);

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = ++idCounter.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setConfirmState(options);
    return new Promise<boolean>(resolve => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirmResponse = (result: boolean) => {
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
    setConfirmState(null);
  };

  const value: ToastContextValue = useMemo(() => ({ showToast, confirm }), [showToast, confirm]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
        {toasts.map(toast => {
          const style = toastStyles[toast.type];
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 ${style.bg} border-l-4 ${style.border} rounded-lg shadow-lg px-4 py-3 animate-slide-in-right`}
            >
              <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
              <p className="text-sm font-medium text-slate-800 flex-1">{toast.message}</p>
              <button
                onClick={() => dismissToast(toast.id)}
                className="text-slate-500 hover:text-slate-600 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirmation dialog */}
      {confirmState && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[9998]">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-start gap-4 mb-6">
              <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${confirmState.destructive ? 'bg-red-100' : 'bg-blue-100'}`}>
                {confirmState.destructive ? (
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                ) : (
                  <Info className="w-5 h-5 text-blue-600" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900 mb-1">
                  {confirmState.title || 'Please confirm'}
                </h3>
                <p className="text-sm text-slate-600 whitespace-pre-line">{confirmState.message}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => handleConfirmResponse(false)}
                className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                {confirmState.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={() => handleConfirmResponse(true)}
                className={`px-5 py-2.5 text-sm font-semibold text-white rounded-lg transition ${
                  confirmState.destructive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirmState.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
