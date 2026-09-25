/*
 * Tiny dependency-free i18n layer.
 *
 * - Dictionaries live in `en/*.ts` (source of truth) and `de/*.ts` (typed against English).
 * - `t(key, params)` looks up the active language and fills `{name}` placeholders.
 * - `tp(base, count, params)` picks `<base>.one` or `<base>.other` via Intl.PluralRules.
 * - The active language is module state, so plain functions (row builders, formatters) can call
 *   `t()` as well. React re-renders through `useLanguage()` / `<LanguageBoundary>` (see react.tsx).
 * - Default is English. The choice is stored in localStorage; the browser language is ignored on
 *   purpose so the UI starts predictably in English until the user picks Deutsch in the settings.
 *
 * Never call `t()` at module top level: the result would be frozen in the language at import time.
 */
import { en, type MessageKey } from './en';
import { de } from './de';
import type { Params } from './types';

export type Language = 'en' | 'de';
export type { MessageKey, Params };

export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];

export const LANGUAGE_STORAGE_KEY = 'replayhaven.language';

const dictionaries: Record<Language, Record<MessageKey, string>> = { en, de };
const locales: Record<Language, string> = { en: 'en-US', de: 'de-DE' };

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'de';
}

function storedLanguage(): Language {
  try {
    const value = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(value)) return value;
  } catch {
    // Private mode or blocked storage: fall back to the default.
  }
  return 'en';
}

let current: Language = storedLanguage();
const listeners = new Set<() => void>();

function applyDocumentLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.title = dictionaries[current]['document.title'];
}
applyDocumentLanguage();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language, persist = true): void {
  if (!isLanguage(language)) return;
  if (persist) {
    try {
      globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
  }
  if (language === current) return;
  current = language;
  applyDocumentLanguage();
  listeners.forEach((listener) => listener());
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** BCP 47 locale for Intl formatters, e.g. `en-US` or `de-DE`. */
export function locale(): string {
  return locales[current];
}

/** Creates a value once per language, e.g. an Intl formatter, and reuses it afterwards. */
export function perLanguage<T>(make: (locale: string) => T): () => T {
  const cache = new Map<Language, T>();
  return () => {
    let value = cache.get(current);
    if (value === undefined) {
      value = make(locales[current]);
      cache.set(current, value);
    }
    return value;
  };
}

export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: MessageKey, params?: Params): string {
  const text = dictionaries[current][key] ?? en[key] ?? key;
  return interpolate(text, params);
}

type PluralBase<K = MessageKey> = K extends `${infer Base}.one` ? Base : never;

const pluralRules = perLanguage((tag) => new Intl.PluralRules(tag));

/** Plural form: looks up `<base>.one` or `<base>.other`; `{count}` is filled automatically. */
export function tp(base: PluralBase, count: number, params?: Params): string {
  const form = pluralRules().select(count) === 'one' ? 'one' : 'other';
  return t(`${base}.${form}` as MessageKey, { count, ...params });
}

/** Locale-aware string comparison for sorting names. */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, locale());
}
