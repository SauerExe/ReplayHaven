import type { common as source } from '../en/common';
import type { Translation } from '../types';

export const common: Translation<typeof source> = {
  'common.back': 'Zurück',
  'common.close': 'Schließen',
  'common.cancel': 'Abbrechen',
  'common.save': 'Speichern',
  'common.delete': 'Löschen',
  'common.retry': 'Erneut versuchen',
  'common.loading': 'Inhalt wird geladen',
  'common.clips.one': '{count} Clip',
  'common.clips.other': '{count} Clips',
  'document.title': 'ReplayHaven · Deine besten Momente',
  'language.label': 'Sprache',
  'language.hint': 'Ändert die Sprache dieser Web-App auf diesem Gerät.',
  'notFound.title': 'Hier ist kein Clip gelandet.',
  'notFound.text': 'Diese Seite gibt es nicht. Dein Archiv findest du gleich nebenan.',
  'notFound.home': 'Zur Startseite',
  'error.title': 'Diese Seite ließ sich nicht laden',
  'error.text':
    'Vielleicht wurde ReplayHaven gerade aktualisiert. Neu laden hilft meist; deine Clips sind sicher.',
  'error.reload': 'Seite neu laden',
  'installer.warning.summary': 'Windows warnt beim Start des Installers?',
  'installer.warning.text':
    'Das ist normal: Der Installer ist noch nicht mit einem kostenpflichtigen Herausgeber-Zertifikat signiert, deshalb zeigt Windows SmartScreen beim ersten Start „Der Computer wurde durch Windows geschützt“.',
  'installer.warning.step1': 'Im blauen Fenster auf „Weitere Informationen“ klicken.',
  'installer.warning.step2': 'Dann auf „Trotzdem ausführen“ klicken.',
  'installer.warning.proof':
    'Jedes Release auf GitHub nennt SHA-256-Prüfsummen und einen Herkunftsnachweis, damit du prüfen kannst, dass die Datei aus dem veröffentlichten Quellcode gebaut wurde.',
};
