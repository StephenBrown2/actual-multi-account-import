import React, { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Catches render and lifecycle errors in child components and displays
 * a human-readable message instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Application error:", error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <main className="app-shell">
          <section className="card error-banner" role="alert">
            <h2>Something went wrong</h2>
            <p>
              The application encountered an unexpected error. This is usually caused by invalid
              data or a temporary glitch.
            </p>
            <pre className="error-message">{this.state.error.message}</pre>
            <p>
              Try refreshing the page. If the problem continues, check that your file format is
              correct and the server is running.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              aria-label="Reload the page"
            >
              Reload page
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
