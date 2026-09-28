/*
 * UI strings of the client window.
 *
 * Every language is a flat dictionary with the same keys (en.ts, de.ts). Values may contain
 * {placeholders} that t(key, params) fills. A value can also be { one, other } for words that
 * change with params.count. index.html refers to keys via data-i18n (text), data-i18n-placeholder,
 * data-i18n-title and data-i18n-aria-label.
 *
 * To add a language: add a dictionary next to en.ts under its code (missing keys fall back to
 * English) and register it in I18N below, add an <option> to the language selects (index.html
 * and the welcome step in wizard/welcome.ts), add the code to Language in api.ts and to
 * `language` in the config schema of desktop/main.ts, and a locale to LOCALES below.
 */
import type { Language } from '../api';
import { de } from './de';
import { en } from './en';

export type Message = string | { one: string; other: string };
export type Dictionary = Record<string, Message>;

const I18N: Record<Language, Partial<Dictionary>> = { en, de };
const LOCALES: Record<Language, string> = { en: 'en-US', de: 'de-DE' };

/** The window language; switch it with selectLanguage (language.ts redraws the window). */
export let language: Language = 'en';
function isLanguage(lang: string): lang is Language {
  return Object.hasOwn(I18N, lang);
}
/** Takes lang as the window language, English for anything unknown. */
export function selectLanguage(lang: string) {
  language = isLanguage(lang) ? lang : 'en';
  return language;
}

/** Text for a key in the current language, with {placeholders} filled from params. */
export function t(key: string, params: Record<string, string | number> = {}) {
  let text = I18N[language]?.[key] ?? I18N.en[key] ?? key;
  if (typeof text === 'object') text = params.count === 1 ? text.one : text.other;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
export function locale() {
  return LOCALES[language] || LOCALES.en;
}
/** Sets the static texts marked with data-i18n* inside root. */
export function applyLanguage(root: ParentNode = document) {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]'))
    node.textContent = t(node.dataset.i18n!);
  for (const [attribute, data] of [
    ['placeholder', 'i18nPlaceholder'],
    ['title', 'i18nTitle'],
    ['aria-label', 'i18nAriaLabel'],
  ])
    for (const node of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`))
      node.setAttribute(attribute, t(node.dataset[data]!));
}
