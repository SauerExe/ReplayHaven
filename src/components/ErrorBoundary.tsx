import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { t } from '../i18n';
import { EmptyState } from './Cards';

const RELOADED_AT = 'replayhaven.chunkReload';
/** A second failure within this time does not reload again, so a broken build cannot loop. */
const RELOAD_GUARD_MS = 30_000;

/**
 * After a redeploy an open tab still asks for the old, now missing page chunks. Vite reports that
 * as `vite:preloadError`; the page then reloads once to fetch the new build. Without storage, or
 * right after such a reload, the error boundary shows its message instead.
 */
export function reloadOnStaleChunks() {
  window.addEventListener('vite:preloadError', (event) => {
    try {
      const last = Number(sessionStorage.getItem(RELOADED_AT) || 0);
      if (Date.now() - last < RELOAD_GUARD_MS) return;
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}

class Boundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean; resetKey: string }
> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: boolean; resetKey: string },
  ) {
    // Another page: try again instead of keeping the message forever.
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page" role="alert">
        <EmptyState title={t('error.title')} description={t('error.text')}>
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            {t('error.reload')}
          </button>
        </EmptyState>
      </div>
    );
  }
}

/** Catches errors of a page (such as a chunk missing after an update) instead of a white screen. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
