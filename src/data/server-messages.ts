import { getLanguage } from '../i18n';

/**
 * The server answers in English (server/*.ts). The web interface shows its messages in the
 * interface language: known messages are translated here, anything unknown stays as sent.
 * Keep this list in step with the server's texts (server-messages.test.ts checks the known ones).
 */
const GERMAN: Record<string, string> = {
  'Please sign in.': 'Bitte melde dich an.',
  'Name or password is wrong.': 'Name oder Passwort ist falsch.',
  'The access key from the server setup is wrong.':
    'Der Zugangsschlüssel aus der Server-Einrichtung ist falsch.',
  'Too many failed attempts. Wait a few minutes.': 'Zu viele Fehlversuche. Warte ein paar Minuten.',
  'An account already exists. Sign in with it.': 'Es gibt schon ein Konto. Melde dich damit an.',
  'An account with this name already exists.': 'Ein Konto mit diesem Namen gibt es schon.',
  'This account is disabled.': 'Dieses Konto ist deaktiviert.',
  'Your account is not available.': 'Dein Konto ist nicht verfügbar.',
  'Account not found.': 'Konto nicht gefunden.',
  'The current password is wrong.': 'Das aktuelle Passwort ist falsch.',
  'Set a password first, otherwise you could no longer sign in.':
    'Lege zuerst ein Passwort fest, sonst könntest du dich nicht mehr anmelden.',
  'Set a password for the new account.': 'Lege ein Passwort für das neue Konto fest.',
  'You cannot disable your own account.': 'Du kannst dein eigenes Konto nicht deaktivieren.',
  'You cannot delete your own account.': 'Du kannst dein eigenes Konto nicht löschen.',
  'The last admin cannot be removed, disabled or demoted.':
    'Der letzte Admin kann nicht entfernt, deaktiviert oder herabgestuft werden.',
  'This action requires an admin account.': 'Dafür brauchst du ein Admin-Konto.',
  'This only works when signed in with a browser.':
    'Das geht nur, wenn du im Browser angemeldet bist.',
  'Device not found.': 'Gerät nicht gefunden.',
  'Code not found.': 'Code nicht gefunden.',
  'The code has expired or was already used. Show a new one.':
    'Der Code ist abgelaufen oder wurde schon benutzt. Zeig einen neuen an.',
  'The link has expired or was already used. Create a new one.':
    'Der Link ist abgelaufen oder wurde schon benutzt. Erstelle einen neuen.',
  'The request has expired. Start the pairing on the PC again.':
    'Die Anfrage ist abgelaufen. Starte die Kopplung am PC neu.',
  'Too many open pairing requests. Try again in a few minutes.':
    'Zu viele offene Kopplungsanfragen. Versuch es in ein paar Minuten noch einmal.',
  'This device ID belongs to another PC.': 'Diese Geräte-ID gehört zu einem anderen PC.',
  'Single sign-on is not configured on this server.':
    'Single Sign-on ist auf diesem Server nicht eingerichtet.',
  'Single sign-on is not configured.': 'Single Sign-on ist nicht eingerichtet.',
  'The sign-in took too long or was started elsewhere. Retry.':
    'Die Anmeldung hat zu lange gedauert oder wurde woanders gestartet. Versuch es noch einmal.',
  'This sign-in is already linked to another account.':
    'Diese Anmeldung ist schon mit einem anderen Konto verknüpft.',
  'No ReplayHaven account belongs to this sign-in. Ask an admin to create one for you.':
    'Zu dieser Anmeldung gehört kein ReplayHaven-Konto. Bitte einen Admin, dir eines anzulegen.',
  'This server has no admin yet. Create the first account with the setup link from the server log, then link this sign-in under Settings → Account.':
    'Dieser Server hat noch keinen Admin. Lege das erste Konto mit dem Einrichtungslink aus dem Server-Log an und verknüpfe diese Anmeldung dann unter Einstellungen → Konto.',
  'The sign-in provider returned no ID token.': 'Der Anmeldedienst hat kein ID-Token geliefert.',
  'Sign-in was cancelled at the sign-in provider.':
    'Die Anmeldung wurde beim Anmeldedienst abgebrochen.',
  'Clip not found.': 'Clip nicht gefunden.',
  'This clip was uploaded by another PC.': 'Dieser Clip wurde von einem anderen PC hochgeladen.',
  'The clip was removed.': 'Der Clip wurde entfernt.',
  'Choose a video file.': 'Wähle eine Videodatei aus.',
  'Supported formats are MP4, WebM, MOV, M4V and MKV.':
    'Unterstützt werden MP4, WebM, MOV, M4V und MKV.',
  'The file is larger than 2 GB.': 'Die Datei ist größer als 2 GB.',
  'Choose a readable video of at most 30 minutes and at most 8K resolution.':
    'Wähle ein lesbares Video mit höchstens 30 Minuten und höchstens 8K-Auflösung.',
  'The file is not available yet.': 'Die Datei ist noch nicht verfügbar.',
  'Wait until video processing has finished.': 'Warte, bis die Videoverarbeitung fertig ist.',
  'Video processing has not failed.': 'Die Videoverarbeitung ist nicht fehlgeschlagen.',
  'The analysis is already running.': 'Die Analyse läuft schon.',
  'Set up an AI provider on the server first.':
    'Richte zuerst einen KI-Anbieter auf dem Server ein.',
  'Analysis and video duration do not match.': 'Analyse und Videolänge passen nicht zusammen.',
  'The Windows installer has not been provided on this server yet.':
    'Der Windows-Installer liegt auf diesem Server noch nicht bereit.',
  'Automatic game info lookups are disabled on this server.':
    'Das automatische Abrufen von Spielinfos ist auf diesem Server abgeschaltet.',
  'No cover available.': 'Kein Cover verfügbar.',
  'The server is running out of disk space. Free up space on the server, then retry.':
    'Auf dem Server wird der Speicherplatz knapp. Schaff dort Platz und versuch es dann noch einmal.',
  'The server is busy. Try again in a moment.':
    'Der Server ist gerade ausgelastet. Versuch es gleich noch einmal.',
  'Not found.': 'Nicht gefunden.',
  'API endpoint not found.': 'API-Endpunkt nicht gefunden.',
  'The request could not be processed. Check the server and the file.':
    'Die Anfrage konnte nicht verarbeitet werden. Prüfe den Server und die Datei.',
};

/** Messages with a variable part: pattern and German version ($1 is the variable part). */
const GERMAN_PATTERNS: [RegExp, string][] = [
  [
    /^Password sign-in is disabled\. Sign in with (.+)\.$/,
    'Die Anmeldung mit Passwort ist abgeschaltet. Melde dich mit $1 an.',
  ],
  [
    /^The sign-in could not be completed: (.+)$/,
    'Die Anmeldung konnte nicht abgeschlossen werden: $1',
  ],
  [
    /^The address (.+) is not allowed\. Add it to REPLAYHAVEN_PUBLIC_ORIGIN on the server\.$/,
    'Die Adresse $1 ist nicht erlaubt. Trag sie auf dem Server in REPLAYHAVEN_PUBLIC_ORIGIN ein.',
  ],
];

export function localizeServerMessage(message: string): string {
  if (getLanguage() !== 'de') return message;
  const known = GERMAN[message];
  if (known) return known;
  for (const [pattern, german] of GERMAN_PATTERNS)
    if (pattern.test(message)) return message.replace(pattern, german);
  return message;
}

/** The English texts this module knows, for the test that compares them with the server. */
export const KNOWN_SERVER_MESSAGES = Object.keys(GERMAN);
