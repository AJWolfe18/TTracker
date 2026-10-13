import { Component, type ReactNode } from 'react';

// ADO-196: one render exception used to blank the whole site. A boundary
// swaps only its own subtree for `fallback`; the rest of the page keeps
// rendering. React itself still logs the caught error to the console
// (createRoot's default onCaughtError), so nothing is swallowed silently.
// No componentDidCatch reporting: the analytics taxonomy has no error event.

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  /**
   * When this changes, a crashed boundary tries its children again (e.g. the
   * route, so navigating away from a broken page recovers without a reload).
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  // Reset after the update, not in getDerivedStateFromProps: there, a key
  // change in the same render as the crash would clear it, and the retry
  // would throw again past this boundary (the react-error-boundary pattern)
  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.failed && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
