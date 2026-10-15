import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { supabase } from './lib/supabase';
import { reportError } from './utils/errorReporter';
import { isChunkLoadError, reloadOnceForStaleChunk } from './utils/staleChunkReload';

window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault();
});

window.addEventListener('error', (event: ErrorEvent) => {
  if (isChunkLoadError(event.error ?? event.message) && reloadOnceForStaleChunk()) return;
  reportError(supabase, {
    message: event.message || 'Unknown window error',
    stack: event.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  if (isChunkLoadError(reason) && reloadOnceForStaleChunk()) return;
  reportError(supabase, {
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection',
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

class GlobalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Global error boundary:', error, info);
    reportError(supabase, {
      message: error.message,
      stack: [error.stack, info.componentStack].filter(Boolean).join('\n'),
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ textAlign: 'center', maxWidth: 480, padding: 32 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Something went wrong</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>
);
