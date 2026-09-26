import { Fragment, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getLanguage, subscribeLanguage, t, type Language, type MessageKey } from './core';

/** Re-renders the calling component when the language changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/**
 * Remounts its children when the language changes, so every component, memo and plain helper
 * that calls `t()` picks up the new language without threading it through props.
 */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const language = useLanguage();
  return <Fragment key={language}>{children}</Fragment>;
}

/**
 * Like `t()`, but placeholders may be React nodes, e.g. a link or `<kbd>` inside a sentence:
 * `tx('player.hint', { key: <kbd>K</kbd> })`.
 */
export function tx(key: MessageKey, parts: Record<string, ReactNode>): ReactNode {
  const text = t(key);
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1];
    if (!(name in parts)) continue;
    nodes.push(text.slice(last, match.index));
    nodes.push(<Fragment key={nodes.length}>{parts[name]}</Fragment>);
    last = match.index + match[0].length;
  }
  nodes.push(text.slice(last));
  return <>{nodes}</>;
}
