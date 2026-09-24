import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Recoverable React error boundary: a rendering error or a failed lazy-chunk
 *  load shows a reload panel instead of blanking the whole application. The
 *  "Try again" action clears the error so React can re-render the subtree. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the failure in the console for diagnosis; never swallow silently.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const isChunkError = /Loading chunk|dynamically imported module|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div role="alert" className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[var(--ocean-border)] bg-[var(--ocean-card)] p-6 text-center shadow-2xl">
          <h2 className="text-base font-semibold text-[var(--ocean-text)]">
            {isChunkError ? 'This section could not load' : 'Something went wrong'}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-[var(--ocean-text-dim)]">
            {isChunkError
              ? 'The application was updated or the connection dropped while loading this section. Reloading usually fixes it.'
              : 'A rendering error occurred in this section. The rest of the application is unaffected.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-lg border border-[var(--ocean-border)] px-4 py-2 text-xs font-semibold text-[var(--ocean-text)] hover:border-cyan-500/50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-lg bg-cyan-500/90 px-4 py-2 text-xs font-semibold text-[#00201a] hover:bg-cyan-400"
            >
              Reload OceanGuard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
