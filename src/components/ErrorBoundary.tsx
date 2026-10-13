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
  resetKey: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    return { failed: false, resetKey: props.resetKey };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
