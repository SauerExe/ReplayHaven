import type { pages as source } from '../en/pages';
import type { Translation } from '../types';

export const pages: Translation<typeof source> = {
  // Setup guide
  'pages.setup.copyFallback':
    'Befehl markiert. Bitte mit Strg+C oder über das Auswahlmenü kopieren.',
  'pages.setup.copyLabel': '{label} kopieren',
  'pages.setup.copied': 'Kopiert',
  'pages.setup.copy': 'Kopieren',
  'pages.setup.stepOf': 'Schritt {step} von 3',
  'pages.setup.requirements': 'Das brauchst du',
  'pages.setup.nav.steps': 'Schritte',
  'pages.setup.server.installTitle': 'Installieren',
  'pages.setup.client.inClient': 'Im Client',
  'pages.setup.firstClip.flow': 'So reist ein Clip',
  'pages.setup.firstClip.done': 'Geschafft',
  'pages.setup.help.text': 'Antworten auf die häufigsten Fragen bei der Einrichtung.',
  'pages.setup.title': 'Einrichtung',
  'pages.setup.description':
    'Drei Schritte vom frischen Server bis zu deinem ersten archivierten Clip.',
  'pages.setup.devices': 'Aufnahme-PCs',
  'pages.setup.requirement.server': 'Server',
  'pages.setup.requirement.serverHint': 'Linux oder NAS mit Docker',
  'pages.setup.requirement.pc': 'Aufnahme-PC',
  'pages.setup.requirement.pcHint': 'Windows 10 / 11 · 64 Bit',
  'pages.setup.requirement.storage': 'Speicherplatz',
  'pages.setup.requirement.storageHint': 'Für deine Originalaufnahmen',
  'pages.setup.nav.label': 'Einrichtungsschritte',
  'pages.setup.nav.server': 'Server einrichten',
  'pages.setup.nav.client': 'PC verbinden',
  'pages.setup.nav.firstClip': 'Ersten Clip archivieren',
  'pages.setup.nav.help': 'Fehlerhilfe',
  'pages.setup.nav.connected': 'Server verbunden',
  'pages.setup.nav.disconnected': 'Kein Server verbunden',
  'pages.setup.server.title': 'Server einrichten',
  'pages.setup.server.text':
    'Du brauchst einen Linux-Rechner oder ein NAS mit Docker Engine und Compose-Plugin. Auf dem Server ist für die Analyse auf deinem PC kein KI-Modell nötig.',
  'pages.setup.server.methods': 'Installationsmethode',
  'pages.setup.server.docker': 'Docker-Image',
  'pages.setup.server.recommended': 'Empfohlen',
  'pages.setup.server.source': 'Aus dem Quellcode',
  'pages.setup.server.dockerInstruction':
    'Öffne ein Terminal auf deinem Server (mit Docker) und starte den Installer.',
  'pages.setup.server.sourceInstruction':
    'Öffne ein Terminal auf deinem Server. Das Setup-Skript führt dich durch die Einrichtung.',
  'pages.setup.server.prepare': 'Server vorbereiten',
  'pages.setup.server.configTitle': 'Den Einrichtungslink öffnen',
  'pages.setup.server.configText':
    'Der Installer prüft Docker, schreibt {env} mit einem neuen {token} und deiner Netzwerkadresse als {origin}, startet den Server und gibt einen Einrichtungslink aus. Öffne ihn und lege dein Konto an, ohne den Schlüssel abzutippen. Erneut ausgeführt, aktualisiert er den Server.',
  'pages.setup.server.keyTitle': 'Den Zugangsschlüssel aufbewahren',
  'pages.setup.server.keyText':
    'Das Skript fragt deine Serveradresse ab, erzeugt deinen Zugangsschlüssel und startet den Server. Den Schlüssel brauchst du genau einmal: beim Anlegen deines Kontos. Der erste Build benötigt Internet und einige Minuten.',
  'pages.setup.server.next':
    'Öffne danach deine Serveradresse im Browser und leg dein Konto an. Weitere Geräte meldest du per QR-Code unter Einstellungen → Geräte an.',
  'pages.setup.server.toSettings': 'Server-Einstellungen',
  'pages.setup.client.title': 'Aufnahme-PC verbinden',
  'pages.setup.client.text': 'Der Windows-Client verbindet deinen Aufnahmeordner mit dem Archiv.',
  'pages.setup.client.downloadTitle': 'ReplayHaven für Windows',
  'pages.setup.client.platform':
    'Windows 10 / 11 · 64 Bit. Node.js, Python oder FFmpeg brauchst du nicht extra.',
  'pages.setup.client.download': 'Herunterladen',
  'pages.setup.client.toDownload': 'Zum Download',
  'pages.setup.client.downloadHint':
    'Der Download erscheint unter Einstellungen → Aufnahme-PCs, sobald dein Server verbunden ist und einen Installer bereitstellt.',
  'pages.setup.client.installTitle': 'Client installieren und öffnen',
  'pages.setup.client.installText': 'Führe den Windows-Installer aus und öffne ReplayHaven Client.',
  'pages.setup.client.pairTitle': 'Mit deinem Server koppeln',
  'pages.setup.client.pairText':
    'Am einfachsten: Öffne diese Seite auf deinem Gaming-PC, geh zu Einstellungen → Aufnahme-PCs und klicke „Diesen PC verbinden“. Oder gib im Client die Serveradresse ein; er zeigt einen Code, den du unter Einstellungen → Aufnahme-PCs freigibst.',
  'pages.setup.client.folderTitle': 'Deinen Aufnahmeordner auswählen',
  'pages.setup.client.folderText':
    'Wähle den Ordner, in dem deine Aufnahme-App Clips speichert. Unterordner werden ebenfalls berücksichtigt.',
  'pages.setup.client.existingTitle': 'Du hast schon Aufnahmen?',
  'pages.setup.client.existingText':
    'Aktiviere „Vorhandene Aufnahmen beim ersten Start mitnehmen“, bevor du die Warteschlange zum ersten Mal startest, wenn deine bisherigen Clips ebenfalls ins Archiv sollen.',
  'pages.setup.firstClip.title': 'Ersten Clip archivieren',
  'pages.setup.firstClip.text':
    'Richte bei Bedarf die lokale Analyse über die Ollama- und Modell-Schaltflächen im Client ein. Starte anschließend „Analyse & Upload starten“ und speichere einen neuen Clip wie gewohnt.',
  'pages.setup.firstClip.save': 'Clip speichern',
  'pages.setup.firstClip.saveHint': 'In deinem Aufnahmeordner',
  'pages.setup.firstClip.process': 'Client verarbeitet',
  'pages.setup.firstClip.processHint': 'Analyse & Upload',
  'pages.setup.firstClip.view': 'In der Bibliothek ansehen',
  'pages.setup.firstClip.viewHint': 'Auf jedem angemeldeten Gerät',
  'pages.setup.firstClip.caption':
    'Warte, bis die Datei fertig geschrieben und der Upload bestätigt ist. Für den ersten Verbindungstest kannst du die lokale Analyse im Client ausschalten.',
  'pages.setup.firstClip.kept': 'Deine lokale Originaldatei bleibt erhalten.',
  'pages.setup.firstClip.openLibrary': 'Bibliothek öffnen',
  'pages.setup.help.title': 'Fehlerhilfe',
  'pages.setup.help.docs': 'Ausführliche Server-Dokumentation',
  'pages.setup.faq.unreachable.title': 'Mein Server ist nicht erreichbar.',
  'pages.setup.faq.unreachable.answer':
    'Öffne zuerst die Serveradresse im Browser. Prüfe auf dem Server mit {ps}, ob der Container läuft. Mit {logs} siehst du die letzten Meldungen.',
  'pages.setup.faq.origin.title':
    'Die Herkunft ist nicht freigegeben oder der Schlüssel wird abgelehnt.',
  'pages.setup.faq.origin.answer':
    '{origin} in der {env} muss genau zur Browseradresse passen, inklusive http/https und Port. Starte danach mit {up} neu. Den Zugangsschlüssel findest du ebenfalls in der {env}.',
  'pages.setup.faq.download.title': 'Unter Aufnahme-PCs wird kein Windows-Download angezeigt.',
  'pages.setup.faq.download.answer':
    'Verbinde zuerst deinen Server in den Einstellungen. Fehlt der Download weiterhin, hinterlege den Installer im Serverordner {release} oder setze {url} in der {env}.',
  'pages.setup.faq.noAi.title': 'Kann ich erst einmal ohne lokale KI starten?',
  'pages.setup.faq.noAi.answer':
    'Ja. Schalte im Client „Neue Clips vor dem Upload lokal analysieren“ aus. Deine Originale werden dann ohne KI-Ergebnis archiviert. Alternativ kannst du einen Clip direkt im Browser hochladen.',
  'pages.setup.faq.originals.title': 'Was passiert mit meinen Originalaufnahmen?',
  'pages.setup.faq.originals.answer':
    'Deine Dateien auf dem PC werden weder umbenannt noch verschoben oder gelöscht. Löschst du eine lokale Aufnahme, bleibt ihre Serverkopie erhalten. Sichere für ein Backup das gesamte Archiv-Volume und die Serverkonfiguration.',

  // Clip page
  'pages.clip.notFound.title': 'Clip nicht gefunden',
  'pages.clip.notFound.text':
    'Der Clip wurde entfernt oder ist eine lokale Vorschau aus einer früheren Sitzung.',
  'pages.clip.toLibrary': 'Zur Bibliothek',
  'pages.clip.yourRecording': 'DEINE AUFNAHME',
  'pages.clip.editTitle': 'Titel bearbeiten',
  'pages.clip.favorite': 'Favorit',
  'pages.clip.addFavorite': 'Favorisieren',
  'pages.clip.addToCollection': 'Zur Sammlung',
  'pages.clip.share': 'Clip teilen',
  'pages.clip.editTags': 'Tags bearbeiten',
  'pages.clip.note': 'Deine Notiz',
  'pages.clip.noteLabel': 'Notiz zum Clip',
  'pages.clip.notePlaceholder': 'Was diesen Moment besonders macht …',
  'pages.clip.noteSaved': 'Wird automatisch gespeichert',
  'pages.clip.localOnly':
    'Nur in diesem Browser verfügbar – noch nicht auf dem Server gespeichert.',
  'pages.clip.original': 'DEIN ORIGINAL',
  'pages.clip.archivedOn': 'Auf deinem Server archiviert · {device}',
  'pages.clip.downloadOriginal': 'Original herunterladen',
  'pages.clip.videoSource': 'VIDEOQUELLE',
  'pages.clip.steamVideo': 'Offizielles Video auf Steam',
  'pages.clip.sampleNote':
    'Beispiel-Card mit echtem, extern eingebundenem Spielvideo. Der Kartentitel beschreibt nicht den Trailer.',
  'pages.clip.technical': 'Technische Informationen',
  'pages.clip.source': 'Quelle',
  'pages.clip.sourceLocal': 'Lokale Datei',
  'pages.clip.sourceServer': 'Dein Archiv-Server',
  'pages.clip.sourceSteam': 'Steam CDN · HLS',
  'pages.clip.fileSize': 'Dateigröße',
  'pages.clip.externalStream': 'Externer Stream',
  'pages.clip.resolution': 'Auflösung',
  'pages.clip.device': 'Ursprungsgerät',
  'pages.clip.thisBrowser': 'Dieser Browser',
  'pages.clip.externalVideo': 'Externes Video',
  'pages.clip.moreFrom': 'Mehr aus {game}',
  'pages.clip.moreFromYours': 'deinen Aufnahmen',
  'pages.share.label': 'Lokale Freigabevorschau',
  'pages.share.warning': 'Vorschau in diesem Browser · Kein öffentlicher Freigabelink',
  'pages.share.localRecording': 'LOKALE AUFNAHME',
  'pages.share.tagline': 'Ein Moment, den man teilen möchte.',
  'pages.share.unavailable.title': 'Freigabe nicht verfügbar',
  'pages.share.unavailable.text':
    'Dieser Link ist ungültig. Lokale Vorschauen funktionieren nur im ursprünglichen Browser.',
  'pages.share.footer': 'ReplayHaven · Ein guter Moment bleibt.',

  // Player
  'pages.player.hlsUnsupported':
    'Dieser Browser unterstützt den Videostream nicht. Öffne das Original oder verwende einen aktuellen Browser.',
  'pages.player.streamUnavailable':
    'Der Videostream ist gerade nicht erreichbar. Prüfe deine Verbindung oder öffne das Original.',
  'pages.player.loadFailed': 'Der Videoplayer konnte nicht geladen werden. Versuche es erneut.',
  'pages.player.playbackFailed':
    'Das Video kann nicht abgespielt werden. Prüfe das Format oder versuche es erneut.',
  'pages.player.processing': 'Clip wird verarbeitet',
  'pages.player.failed': 'Dieser Clip konnte nicht verarbeitet werden',
  'pages.player.noVideo': 'Keine Videodatei vorhanden',
  'pages.player.processingText': 'Der Clip steht nach der Verarbeitung zur Verfügung.',
  'pages.player.noVideoText': 'Füge über „Clip hochladen“ eine lokale Videodatei hinzu.',
  'pages.player.errorTitle': 'Der Moment muss kurz warten.',
  'pages.player.openOriginal': 'Original öffnen',
  'pages.player.resumeAt': 'Bei {time} weiterschauen?',
  'pages.player.resume': 'Fortsetzen',
  'pages.player.restart': 'Von vorne',
  'pages.player.localRecording': 'Lokale Aufnahme',
  'pages.player.yourRecording': 'Deine Aufnahme',
  'pages.player.officialVideo': 'Offizielles Spielvideo',
  'pages.player.speed': 'Tempo',
  'pages.player.speedLabel': 'Wiedergabegeschwindigkeit',
  'pages.player.pip': 'Bild-in-Bild',
  'pages.player.pipUnavailable': 'Bild-in-Bild ist für dieses Video nicht verfügbar.',
};
