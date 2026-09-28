import { afterEach, describe, expect, it } from 'vitest';
import { formatRemaining, formatTotal, formatUpdated, formatWhen } from '../streaming/format';
import { serverStatus } from '../streaming/model';
import { buildRows } from '../streaming/rows';
import { SMART_RULES } from '../streaming/smart';
import { de } from './de';
import { en } from './en';
import { interpolate } from './core';
import { getLanguage, locale, setLanguage, t, tagLabel, tp } from '.';

const NOW = new Date(2026, 8, 24, 21, 40).getTime();
const at = (daysAgo: number, hours: number, minutes = 0) =>
  new Date(2026, 8, 24 - daysAgo, hours, minutes).toISOString();

afterEach(() => setLanguage('en', false));

describe('i18n core', () => {
  it('defaults to English', () => {
    expect(getLanguage()).toBe('en');
    expect(locale()).toBe('en-US');
    expect(t('common.back')).toBe('Back');
  });

  it('switches to German', () => {
    setLanguage('de', false);
    expect(locale()).toBe('de-DE');
    expect(t('common.back')).toBe('Zurück');
  });

  it('fills placeholders and picks plural forms', () => {
    expect(interpolate('{a} and {b}, {missing}', { a: 1, b: 'two' })).toBe('1 and two, {missing}');
    expect(tp('common.clips', 1)).toBe('1 clip');
    expect(tp('common.clips', 3)).toBe('3 clips');
    setLanguage('de', false);
    expect(tp('common.clips', 1)).toBe('1 Clip');
  });

  it('has a German entry for every English key and the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(de[key], key).toBeTypeOf('string');
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('English formatting', () => {
  it('writes relative dates, lengths and remaining time', () => {
    expect(formatWhen(at(0, 21, 14), NOW)).toBe('Today, 9:14 PM');
    expect(formatWhen(at(1, 9), NOW)).toBe('Yesterday');
    expect(formatWhen(at(3, 9), NOW)).toBe('3 days ago');
    expect(formatWhen(at(40, 9), NOW)).toBe('Aug 15');
    expect(formatRemaining(40.4, 54)).toBe('0:14 left');
    expect(formatTotal(3900)).toBe('1 hr 5 min');
    expect(formatUpdated(at(3, 9), NOW)).toBe('updated 3 days ago');
    expect(formatUpdated(at(40, 9), NOW)).toBe('updated on Aug 15');
  });

  it('labels home rows, server status and automatic collections', () => {
    const rows = buildRows({ clips: [], collections: [] }, NOW);
    expect(rows).toEqual([]);
    expect(serverStatus({ connected: false, devices: [] }, NOW).text).toBe('Server not connected');
    expect(SMART_RULES.find((rule) => rule.id === 'gewonnen')?.title).toBe('Matches won');
    setLanguage('de', false);
    expect(SMART_RULES.find((rule) => rule.id === 'gewonnen')?.title).toBe('Gewonnene Matches');
    expect(formatWhen(at(0, 9, 5), NOW)).toBe('Heute, 09:05');
  });

  it('names the analysis tags in English and leaves other tags as typed', () => {
    expect(tagLabel('Rundensieg')).toBe('Round won');
    expect(tagLabel('Ace')).toBe('Ace');
    expect(tagLabel('Mein Tag')).toBe('Mein Tag');
    setLanguage('de', false);
    expect(tagLabel('Rundensieg')).toBe('Rundensieg');
  });
});
