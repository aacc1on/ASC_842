import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, LayoutDashboard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';

interface ErrorBoundaryProps {
  children: ReactNode;
  sectionName?: string;
  onGoToDashboard?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    reportError(supabase, {
      message: error.message || 'Unknown render error',
      stack: [error.stack, errorInfo.componentStack].filter(Boolean).join('\n---\n'),
    });
  }

  handleTryAgain = () => {
    this.setState({ hasError: false });
  };

  handleGoToDashboard = () => {
    this.setState({ hasError: false });
    this.props.onGoToDashboard?.();
  };

  render() {
    if (this.state.hasError) {
      const sectionLabel = this.props.sectionName
        ? ` in ${this.props.sectionName}`
        : ' in this section';

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 max-w-md w-full p-8 text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-7 h-7 text-amber-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              Something went wrong{sectionLabel}
            </h3>
            <p className="text-sm text-slate-500 mb-6">
              An unexpected error occurred while rendering this part of the page.
              You can try loading it again or return to the dashboard.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleTryAgain}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
              >
                <RefreshCw className="w-4 h-4" />
                Try again
              </button>
              <button
                onClick={this.handleGoToDashboard}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                <LayoutDashboard className="w-4 h-4" />
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
