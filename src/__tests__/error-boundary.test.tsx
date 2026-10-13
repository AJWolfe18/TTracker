import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CrashNotice } from '../edge-states/CrashNotice';

// Node env, no jsdom: the server renderer never runs error boundaries, so the
// fallback decision is tested through the lifecycle statics and render()
// directly, and the markup through renderToString (ADO-196).

const boundary = (resetKey?: unknown) =>
  new ErrorBoundary({ fallback: 'FALLBACK', children: 'CHILDREN', resetKey });

describe('ErrorBoundary (ADO-196)', () => {
  it('renders its children until something below throws', () => {
    expect(boundary().render()).toBe('CHILDREN');
    expect(renderToString(<ErrorBoundary fallback="FALLBACK"><p>ok</p></ErrorBoundary>)).toBe('<p>ok</p>');
  });

  it('switches to the fallback once a child throws', () => {
    const b = boundary();
    b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError() };
    expect(b.render()).toBe('FALLBACK');
  });

  it('stays on the fallback while the reset key is unchanged', () => {
    const state = { failed: true, resetKey: '/eos/1' };
    expect(ErrorBoundary.getDerivedStateFromProps({ fallback: null, children: null, resetKey: '/eos/1' }, state)).toBeNull();
  });

  it('tries its children again when the reset key changes (navigating away)', () => {
    const state = { failed: true, resetKey: '/eos/1' };
    expect(ErrorBoundary.getDerivedStateFromProps({ fallback: null, children: null, resetKey: '/about' }, state))
      .toEqual({ failed: false, resetKey: '/about' });
  });
});

describe('CrashNotice (ADO-196)', () => {
  it('renders without a theme provider (the root boundary sits outside it)', () => {
    const html = renderToString(<CrashNotice page />);
    expect(html).toContain('This page hit an error.');
    expect(html).toContain('Reload the page');
    expect(html).toContain('role="alert"');
    expect(html).toContain('<h1');
  });

  it('uses an h2 for a section inside a page', () => {
    const html = renderToString(<CrashNotice />);
    expect(html).toContain('This section hit an error.');
    expect(html).toContain('<h2');
    expect(html).not.toContain('<h1');
  });
});
