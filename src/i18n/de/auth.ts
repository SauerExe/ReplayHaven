import type { auth as source } from '../en/auth';
import type { Translation } from '../types';

export const auth: Translation<typeof source> = {
  // AuthGate.tsx
  'auth.signInFailed': 'Anmeldung fehlgeschlagen.',
  'auth.checking': 'Verbindung wird geprüft',
  'auth.dismiss': 'Schließen',
  'auth.failed': 'Das hat nicht geklappt.',
  'auth.passwordMismatch': 'Die beiden Passwörter sind verschieden.',
  'auth.kicker.setup': 'ERSTE EINRICHTUNG',
  'auth.kicker.login': 'DEIN ARCHIV',
  'auth.title.setup': 'Leg dein Konto an.',
  'auth.title.login': 'Willkommen zurück.',
  'auth.lead.setup':
    'Mit diesem Konto meldest du dich auf jedem Gerät an. Aufnahme-PCs koppelst du danach mit einem Klick.',
  'auth.lead.login':
    'Melde dich an, um deine Clips zu sehen. Auf dem Handy geht es auch per QR-Code von einem angemeldeten Gerät.',
  'auth.sso.signInWith': 'Mit {name} anmelden',
  'auth.sso.generic': 'Single Sign-on',
  'auth.sso.setupTitle': 'Leg das erste Konto an.',
  'auth.sso.setupLead': 'Melde dich mit {name} an. Das erste Konto wird Admin dieses Servers.',
  'auth.sso.loginLead': 'Melde dich mit {name} an, um deine Clips zu sehen.',
  'auth.sso.notConfigured': 'Single Sign-on ist auf diesem Server nicht eingerichtet.',
  'auth.or': 'oder',
  'auth.field.name': 'Name',
  'auth.field.password': 'Passwort',
  'auth.field.repeat': 'Passwort wiederholen',
  'auth.field.key': 'Zugangsschlüssel aus der Server-Einrichtung',
  'auth.field.keyHint':
    'Steht in deiner {file} als {name}. Er verhindert, dass jemand anderes das erste Konto anlegt.',
  'auth.submit.setup': 'Konto anlegen',
  'auth.submit.login': 'Anmelden',
  'auth.connect.codeFailed': 'Der Code ließ sich nicht einlösen.',
  'auth.connect.signingIn': 'Gerät wird angemeldet …',
  'auth.connect.toLogin': 'Zur Anmeldung',
};
