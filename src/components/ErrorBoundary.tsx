import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  error?: Error | null;
  info?: React.ErrorInfo | null;
};

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    info: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console for development
    // In production, you can send this to a logging service
    console.error('Unhandled error caught in ErrorBoundary:', error, info);
    this.setState({ error, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-red-700">Something went wrong</h1>
            <p className="mt-3 text-sm text-gray-600">An unexpected error occurred while loading the app.</p>
            {this.state.error ? (
              <pre className="mt-4 text-left text-xs text-gray-700 whitespace-pre-wrap break-words bg-gray-50 p-3 rounded-lg">
                {this.state.error.toString()}
              </pre>
            ) : null}
            <button
              type="button"
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
