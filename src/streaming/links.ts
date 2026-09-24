import type { MouseEvent } from 'react';

export type Navigate = (href: string) => void;

/** Echte Links mit href, damit Mittelklick und „In neuem Tab öffnen“ funktionieren; sonst navigiert die App. */
export function linkHandler(onNavigate: Navigate | undefined, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !onNavigate ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(href);
  };
}

export function prefersReducedMotion() {
  return (
    document.documentElement.dataset.reduced === 'true' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
