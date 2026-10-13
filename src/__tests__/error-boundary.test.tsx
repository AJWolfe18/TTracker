import { describe, it, expect, vi } from 'vitest';
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

  // componentDidUpdate after a render with these props, previous key '/eos/1'
  const afterUpdate = (failed: boolean, resetKey: unknown) => {
    const b = boundary(resetKey);
    b.state = { failed };
    const setState = vi.fn();
    b.setState = setState;
    b.componentDidUpdate({ fallback: 'FALLBACK', children: 'CHILDREN', resetKey: '/eos/1' });
    return setState;
  };

  it('stays on the fallback while the reset key is unchanged', () => {
    expect(afterUpdate(true, '/eos/1')).not.toHaveBeenCalled();
  });

  it('tries its children again when the reset key changes (navigating away)', () => {
    expect(afterUpdate(true, '/about')).toHaveBeenCalledWith({ failed: false });
  });

  it('a key change with nothing crashed changes nothing', () => {
    expect(afterUpdate(false, '/about')).not.toHaveBeenCalled();
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
