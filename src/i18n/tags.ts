import { getLanguage } from './core';

/**
 * English names for the tags the analysis assigns (CLIP_TAGS in server/schema.ts). The stored tag
 * stays German, because filters, links and automatic collections match on it; only the label
 * follows the interface language. Tags added by hand are shown as typed.
 */
const ENGLISH: Record<string, string> = {
  Tod: 'Death',
  Rundensieg: 'Round won',
  'Runde verloren': 'Round lost',
  Sieg: 'Victory',
  Niederlage: 'Defeat',
  Ladebildschirm: 'Loading screen',
  Menü: 'Menu',
};

export function tagLabel(tag: string): string {
  return getLanguage() === 'en' ? (ENGLISH[tag] ?? tag) : tag;
}
