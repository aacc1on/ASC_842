import { AlertCircle, RefreshCw } from 'lucide-react';

interface LoadErrorProps {
  message: string;
  onRetry: () => void;
  className?: string;
}

/** Inline banner shown when a screen's data failed to load, with a Retry action. */
export function LoadError({ message, onRetry, className = '' }: LoadErrorProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 ${className}`}
    >
      <div className="flex items-start gap-3 flex-1">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center justify-center gap-2 px-3 py-1.5 font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Retry
      </button>
    </div>
  );
}
