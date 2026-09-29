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
  'error.title': 'This page could not be loaded',
  'error.text':
    'Perhaps ReplayHaven was just updated. Reloading the page usually fixes it; your clips are safe.',
  'error.reload': 'Reload page',
  'installer.warning.summary': 'Windows warns when you start the installer?',
  'installer.warning.text':
    'That is expected: the installer is not yet signed with a paid publisher certificate, so Windows SmartScreen shows “Windows protected your PC” the first time.',
  'installer.warning.step1': 'Click “More info” in the blue window.',
  'installer.warning.step2': 'Click “Run anyway”.',
  'installer.warning.proof':
    'Every release on GitHub lists SHA-256 checksums and a build attestation, so you can check the file was built from the published source.',
} satisfies Messages;
