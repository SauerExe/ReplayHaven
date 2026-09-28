import type { auth as source } from '../en/auth';
import type { Translation } from '../types';

export const auth: Translation<typeof source> = {
  // AuthGate.tsx
  'auth.signInFailed': 'Anmeldung fehlgeschlagen.',
  'auth.checking': 'Verbindung wird geprüft',
  'auth.dismiss': 'Schließen',
  'auth.failed': 'Das hat nicht geklappt.',
  'auth.passwordMismatch': 'Die beiden Passwörter sind verschieden.',
  'auth.title.setup': 'Admin-Konto anlegen',
  'auth.title.login': 'Bei deinem Konto anmelden',
  'auth.lead.setup':
    'Mit diesem Konto meldest du dich auf jedem Gerät an. Es wird Admin dieses Servers.',
  'auth.sso.signInWith': 'Mit {name} anmelden',
  'auth.sso.generic': 'Single Sign-on',
  'auth.sso.setupLead': 'Melde dich mit {name} an. Das erste Konto wird Admin dieses Servers.',
  'auth.sso.loginLead': 'Dieser Server nutzt {name} für die Anmeldung.',
  'auth.sso.notConfigured': 'Single Sign-on ist auf diesem Server nicht eingerichtet.',
  'auth.or': 'oder',
  'auth.field.name': 'Name',
  'auth.field.password': 'Passwort',
  'auth.field.repeat': 'Passwort wiederholen',
  'auth.field.passwordHint': 'Mindestens 8 Zeichen.',
  'auth.field.key': 'Zugangsschlüssel der Einrichtung',
  'auth.field.keyHint':
    'Steht in deiner {file} als {name}. Er verhindert, dass jemand anderes das erste Konto anlegt.',
  'auth.field.keyFromLink': 'Zugangsschlüssel aus dem Einrichtungslink übernommen.',
  'auth.field.keyShow': 'Ändern',
  'auth.missing.name': 'Gib deinen Namen ein.',
  'auth.missing.password': 'Gib dein Passwort ein.',
  'auth.missing.key': 'Gib den Zugangsschlüssel aus der Server-Einrichtung ein.',
  'auth.passwordShort': 'Das Passwort braucht mindestens 8 Zeichen.',
  'auth.qr.toggle': 'Stattdessen QR-Code nutzen',
  'auth.qr.steps':
    'Öffne auf einem angemeldeten Gerät Einstellungen → Geräte, wähle „Handy verbinden“ und scanne den Code mit der Kamera dieses Handys.',
  'auth.help.login':
    'Anmeldung am Handy? Scanne den QR-Code unter Einstellungen → Geräte auf einem angemeldeten Gerät.',
  'auth.help.setup': 'Danach koppelst du deine Aufnahme-PCs mit einem Klick.',
  'auth.help.connect': 'Codes gelten ein paar Minuten und nur einmal.',
  'auth.submit.setup': 'Konto anlegen',
  'auth.submit.login': 'Anmelden',
  'auth.submitting': 'Bitte warten',
  'auth.language': 'Sprache',
  'auth.aside.eyebrow': 'Dein Clip-Archiv',
  'auth.aside.title': 'Jedes Highlight, benannt und sicher.',
  'auth.aside.lead':
    'Dein PC beobachtet den Aufnahmeordner, benennt jeden Clip mit lokaler KI und gibt das Original an deinen eigenen Server.',
  'auth.aside.ai.title': 'Benannt auf deinem PC',
  'auth.aside.ai.text':
    'Kills, Karte und Moment, gelesen von einem lokalen Modell. Nichts verlässt dein Zuhause.',
  'auth.aside.server.title': 'Originale auf deinem Server',
  'auth.aside.server.text': 'Volle Qualität, dazu eine flüssige Fassung für unterwegs.',
  'auth.aside.devices.title': 'Auf jedem Gerät',
  'auth.aside.devices.text':
    'Browser, Handy oder Fernseher. Einmal anmelden, 30 Tage angemeldet bleiben.',
  'auth.aside.sampleTag': 'KI-Titel',
  'auth.connect.codeFailed': 'Der Code ließ sich nicht einlösen.',
  'auth.connect.signingIn': 'Gerät wird angemeldet …',
  'auth.connect.failedTitle': 'Dieser Code hat nicht geklappt',
  'auth.connect.failedLead':
    'Hol dir unter Einstellungen → Geräte auf einem angemeldeten Gerät einen neuen QR-Code oder melde dich mit Name und Passwort an.',
  'auth.connect.toLogin': 'Zur Anmeldung',
};
