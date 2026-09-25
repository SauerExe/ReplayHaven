import type { Messages } from '../types';

/** Shared words and the language selector. Namespaced files hold everything else. */
export const common = {
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.retry': 'Try again',
  'common.loading': 'Loading content',
  'common.clips.one': '{count} clip',
  'common.clips.other': '{count} clips',
  'document.title': 'ReplayHaven · Your best moments',
  'language.label': 'Language',
  'language.hint': 'Changes the language of this web app on this device.',
  'notFound.title': 'No clip landed here.',
  'notFound.text': 'This page does not exist. Your archive is right next door.',
  'notFound.home': 'Go to home',
} satisfies Messages;
