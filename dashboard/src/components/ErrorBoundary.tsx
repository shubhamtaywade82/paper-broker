import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  errorId: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null, errorId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: `UI-${Date.now().toString(36)}` };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[dashboard] render error', {
      errorId: this.state.errorId,
      message: error.message,
      stack: info.componentStack,
    });
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-white" role="alert">
          <h2 className="text-lg font-semibold text-red-400">Panel error</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Incident <code>{this.state.errorId}</code>. The trading engine is unaffected — this is a display failure.
          </p>
          <button
            onClick={() => this.setState({ error: null, errorId: null })}
            className="mt-4 rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
          >
            Retry panel
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
