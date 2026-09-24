# Produkt- und Designbrief

Dieser Brief beschreibt, wie die Weboberfläche von ReplayHaven aussehen, sich anfühlen und funktionieren soll: Produktidee, Designsystem, Ansichten, Zustände und Qualitätsmaßstab. Änderungen an der Oberfläche richten sich danach.

Name: **ReplayHaven**.

Das Qualitätsziel ist eine Streaming-Oberfläche auf Netflix-Niveau: starke Bildkomposition, überzeugende Typografie, flüssige Bedienung und durchgängige Detailqualität. Entwickle eine eigenständige Identität.

## 1. Auftrag

Baue die Anwendung tatsächlich. Liefere nicht nur einen Plan oder eine statische Konzeptseite.

Der erste Schwerpunkt ist eine vollständige, interaktive und visuell ausgereifte Weboberfläche. Implementiere alle zentralen Ansichten und ihre Zustände. Nutze eine sauber getrennte Demo-Datenschicht, solange kein Backend existiert.

Prüfe zunächst das vorhandene Repository. Übernimm vorhandene Frameworks, Komponenten und Konventionen, sofern sie zum Ziel passen. Beginne bei einem bestehenden Projekt nicht unnötig von vorn.

Arbeite selbstständig, triff konsistente Produktentscheidungen und überprüfe das Ergebnis im Browser, sofern die Umgebung dies ermöglicht.

## 2. Produktidee

ReplayHaven sammelt Gaming-Clips automatisch vom PC und macht sie in einer privaten Mediathek zugänglich.

Der spätere Ablauf:

1. OBS, NVIDIA oder Xbox Game Bar speichern Aufnahmen in einem lokalen Ordner.
2. Eine kleine Desktop-Anwendung überwacht ausgewählte Ordner.
3. Fertig geschriebene Dateien werden auf den eigenen Server hochgeladen.
4. Der Server verarbeitet Metadaten und Vorschaubilder.
5. Clips erscheinen in der Weboberfläche und lassen sich ansehen, organisieren und teilen.

Wichtige Produktregel:

Es handelt sich standardmäßig um ein Upload-Archiv. Wird eine Datei auf dem PC gelöscht, bleibt die Serverkopie erhalten. Eine automatische Löschung lokaler Dateien ist eine spätere, ausdrücklich aktivierte Funktion.

Die Weboberfläche kann nicht eigenständig beliebige Windows-Ordner dauerhaft überwachen. Stelle eine Desktop-Verbindung ehrlich dar und täusche diese Fähigkeit nicht vor.

## 3. Zielgruppe und Atmosphäre

Die Anwendung richtet sich an Gamer, die ihre Highlights behalten und einfach wiederfinden wollen:

* kompetitive Clutches;
* lustige Situationen mit Freunden;
* besondere Siege;
* atmosphärische Spielmomente;
* kurze Aufnahmen aus längeren Sessions.

Die Atmosphäre ist dunkel, filmisch, hochwertig und persönlich.

Die Clips sind das visuelle Zentrum. Navigation, Filter und Metadaten unterstützen sie.

Vermeide eine Verwaltungssoftware-Ästhetik mit Statistik-Kacheln und Tabellen als Startseite. Ebenso vermeiden: RGB-Gaming-Klischees, Neonränder, übermäßige Glows, Cyberpunk-Schriften und dekorative Glassmorphism-Flächen.

## 4. Technischer Ausgangspunkt

Falls kein Stack vorgegeben ist:

* React und TypeScript;
* Vite;
* Tailwind CSS;
* React Router;
* Lucide Icons;
* zugängliche Headless-Komponenten für Dialoge und Menüs;
* CSS-Animationen oder eine bereits vorhandene Motion-Bibliothek;
* eine austauschbare Datenzugriffsschicht;
* lokale Persistenz für Demo-Einstellungen und Nutzeraktionen.

Verwende bestehende Abhängigkeiten sinnvoll. Installiere keine umfangreichen Bibliotheken für kleine Effekte.

Das Frontend soll später an einen selbst hostbaren Server anschließbar sein. Baue in dieser Phase keine eigene Transcoding-Infrastruktur, keinen Desktop-Agenten und kein vollständiges Authentifizierungssystem.

## 5. Designsystem

Verwende folgende Palette als Grundlage:

| Token              | Farbe   |
| ------------------ | ------- |
| Hintergrund        | #0E1015 |
| Navigation         | #151821 |
| Karten und Dialoge | #1C202B |
| Rahmen             | #2C3241 |
| Primärer Text      | #F2F3F7 |
| Sekundärer Text    | #9CA5B8 |
| Akzent             | #A78BFA |
| Akzent Hover       | #C4B5FD |
| Erfolg             | #5DD6A4 |
| Fehler             | #F47C87 |

Primäre Buttons erhalten violetten Hintergrund und dunklen Text.

Setze Violett gezielt ein:

* wichtigste Aktionen;
* aktive Navigation;
* Wiedergabe- und Uploadfortschritt;
* ausgewählte Filter;
* Fokuszustände.

Nutze große dunkle Flächen mit subtiler Abstufung. Rahmen sollen nur dort sichtbar sein, wo sie die Struktur verbessern.

Typografie:

* prägnante, gut lesbare Sans-Serif;
* beispielsweise lokal verfügbare Geist oder Inter;
* große, eng gesetzte Hero-Überschriften;
* klare Größenhierarchie;
* tabellarische Ziffern für Zeiten und Dateigrößen;
* keine durchgängigen Großbuchstaben außer kleinen Labels.

Gestaltung:

* konsistente Abstände auf einer 4-/8-Pixel-Basis;
* Karten mit etwa 10–14 Pixeln Radius;
* Dialoge mit etwas größeren Radien;
* überwiegend kompakte Controls;
* großzügige Abstände zwischen Inhaltsbereichen;
* zurückhaltende Schatten.

Prüfe Textkontrast und Fokusdarstellung. Sekundäre Informationen müssen weiterhin gut lesbar sein.

## 6. Navigation und Seitenstruktur

Desktop:

Eine oben fixierte Navigation über die gesamte Breite. Im Hero ist sie zunächst transparent mit dunklem Verlauf; beim Scrollen erhält sie einen nahezu deckenden Hintergrund.

Links:

* eigenständige, einfache ReplayHaven-Wortmarke;
* dezente Bildmarke, die sich auch als App-Icon eignet.

Mittig oder daneben:

* Start;
* Bibliothek;
* Sammlungen.

Rechts:

* Suche;
* Upload-Aktion;
* kompakter Verbindungsstatus;
* Profilmenü mit Zugriff auf Geräte und Einstellungen.

Kein permanenter breiter Verwaltungsbereich links.

Mobile:

* kompakter Header;
* untere Navigation für Start, Bibliothek, Sammlungen und Mehr;
* sichtbare aktive Zustände;
* ausreichend Abstand zum unteren Bildschirmrand und Safe Area.

Routen:

* `/`
* `/library`
* `/clips/:id`
* `/collections`
* `/collections/:id`
* `/devices`
* `/settings`
* `/share/:token`

## 7. Startseite

Die Startseite ist die wichtigste Designfläche. Sie muss schon beim ersten Aufruf wie ein fertiges Produkt wirken.

### Hero

Ein großflächiger Featured Clip bildet den Einstieg.

Desktop:

* ungefähr 60–72 Prozent der Viewport-Höhe, mit sinnvoller Obergrenze;
* großflächiges Gameplay-Motiv;
* dunkler Verlauf nach links für Textlesbarkeit;
* weicher Übergang nach unten in den Seitenhintergrund;
* Motivschwerpunkt möglichst rechts;
* Text links unten;
* keine zusätzliche eingerahmte Karte um den Hero.

Hero-Inhalt:

* kleines Label wie „DEIN LETZTES HIGHLIGHT“;
* prägnanter Clip-Titel;
* Spielname, Aufnahmedatum, Dauer und Auflösung;
* maximal ein kurzer beschreibender Satz;
* primär „Abspielen“;
* sekundär „Zur Sammlung“;
* optional eine zurückhaltende Detailaktion.

Beispiel:

„Eine Runde. Fünf Treffer.“

VALORANT · Gestern · 00:42 · 1440p

Darunter: „Der letzte Push hat doch noch funktioniert.“

Wenn ein passendes Preview-Video existiert, darf es stumm und nur unter geeigneten Bedingungen laufen. Berücksichtige reduzierte Bewegung und Datensparmodus. Ansonsten verwende ein hochwertiges Standbild.

Kein automatischer Wechsel zwischen mehreren Hero-Slides.

Mobile:

* kompakterer Hero;
* angepasster Bildausschnitt;
* lesbarer Titel ohne Überlagerung wichtiger Bedienelemente;
* klare Hauptaktion.

### Inhaltsreihen

Unter dem Hero:

1. Zuletzt hinzugefügt.
2. Weiterschauen – nur bei tatsächlichem Fortschritt.
3. Deine Spiele.
4. Favoriten.
5. Sammlungen.

Zeige je Reihe wenige sorgfältig gestaltete Elemente. Nicht jede Reihe muss die gleiche Kartenform verwenden.

„Zuletzt hinzugefügt“ und „Favoriten“ verwenden horizontale Videokarten.

„Deine Spiele“ verwendet größere hochformatige Cover oder passende illustrative Spielmotive.

Sammlungen verwenden aus mehreren Thumbnails zusammengesetzte Cover.

Die nächste Inhaltsreihe soll auf üblichen Desktop-Auflösungen bereits unter dem Hero erkennbar sein.

## 8. Clip-Karten

Format 16:9.

Auf dem Vorschaubild:

* Dauer rechts unten;
* optional dezentes Favoriten-Icon;
* Fortschrittslinie am unteren Rand bei begonnenen Clips;
* Status-Badge nur bei Verarbeitung oder Fehler.

Unter dem Bild:

* Clip-Titel;
* Spielname;
* relative Zeitangabe.

Titel maximal zweizeilig. Verhindere Layoutsprünge durch wechselnde Textlängen.

Hover:

* sanfte Hervorhebung;
* kleine Play-Aktion;
* Zugriff auf das Kontextmenü;
* höchstens minimale Skalierung, ohne Nachbarkarten zu überdecken.

Kontextmenü:

* Abspielen;
* Favorisieren oder Favorit entfernen;
* Zu Sammlung hinzufügen;
* Umbenennen;
* Teilen;
* Herunterladen, wenn eine Datei existiert;
* Löschen.

Auf Touch-Geräten müssen diese Aktionen ohne Hover erreichbar sein.

Hover-Previews nur, wenn echte Videos vorhanden sind. Lade sie verzögert und stoppe sie zuverlässig beim Verlassen der Karte. Spiele niemals mehrere Vorschauen gleichzeitig ab.

## 9. Bibliothek

Die Bibliothek ist eine leistungsfähige, übersichtliche Clip-Galerie.

Oben:

* Titel „Bibliothek“;
* tatsächliche Clip-Anzahl;
* Suche;
* Upload-Aktion.

Filter:

* Spiel;
* Favoriten;
* Zeitraum;
* Tags;
* Verarbeitungsstatus.

Sortierung:

* Neueste zuerst;
* Älteste zuerst;
* Titel;
* Dauer;
* Dateigröße.

Nutze kompakte Filterchips und Popovers. Aktive Filter müssen sichtbar und leicht zurücksetzbar sein.

Die Suche berücksichtigt Titel, Spiel und Tags. Suche, Filter und Sortierung müssen gemeinsam funktionieren.

Desktop ungefähr vier bis fünf Karten pro Reihe, abhängig von verfügbarer Breite. Tablet zwei bis drei. Mobile eine bis zwei, ohne unlesbare Miniaturkarten.

Mehrfachauswahl:

* expliziter Auswahlmodus;
* Clips markieren;
* ausgewählte Clips zu einer Sammlung hinzufügen;
* favorisieren;
* nach Bestätigung löschen.

Die Aktionsleiste erscheint nur bei aktiver Auswahl.

## 10. Clip-Detailseite und Player

Ein eigener, direkt verlinkbarer Clip-Bereich.

Der Player steht im Vordergrund und nutzt die verfügbare Fläche großzügig.

Funktionen:

* Wiedergabe und Pause;
* Seekbar;
* aktuelle Zeit und Gesamtdauer;
* Lautstärke und Stummschaltung;
* Vollbild;
* Wiedergabegeschwindigkeit;
* Picture-in-Picture, sofern unterstützt.

Ein hochwertig integrierter nativer Player ist besser als unvollständige eigene Controls.

Tastatur:

* Leertaste für Wiedergabe/Pause;
* Pfeiltasten zum Springen;
* M für stumm;
* F für Vollbild;
* Escape zum Schließen geeigneter Overlays.

Shortcuts greifen nicht, wenn der Nutzer in einem Eingabefeld schreibt. Verhindere Konflikte mit nativen Player-Funktionen.

Unter dem Player:

* editierbarer Titel;
* Spiel und Aufnahmedatum;
* Favorit;
* Teilen;
* Zu Sammlung;
* weiteres Menü;
* Tags;
* optionale Notiz.

Technische Informationen wie Codec, Dateigröße und Ursprungsgerät gehören in einen einklappbaren Detailbereich.

Weitere Clips desselben Spiels erscheinen darunter.

Wiedergabefortschritt speichern und bei erneutem Öffnen anbieten. Ein fast vollständig gesehener Clip soll nicht dauerhaft unter „Weiterschauen“ stehen.

Verwende echte Player-Ereignisse für Fortschritt und Fehlerzustände.

## 11. Sammlungen

Sammlungen sind kuratierte Gruppen eigener Clips.

Beispiele:

* „Clutches“;
* „Mit den Jungs“;
* „Komplettes Chaos“;
* „Beste Momente 2026“.

Übersicht:

* große Coverkarten;
* Titel;
* Anzahl enthaltener Clips;
* letzte Änderung.

Detailseite:

* Coverkomposition;
* editierbarer Titel und Beschreibung;
* zugehörige Clips;
* Clips hinzufügen und entfernen.

Neue Sammlung über einen kleinen zugänglichen Dialog erstellen. Eingaben validieren.

Sammlungen und Favoriten müssen nach einem Neuladen erhalten bleiben.

## 12. Uploads und Geräte

Der Uploadstatus ist jederzeit über ein kompaktes Element erreichbar.

Eine seitliche Ansicht oder ein Panel zeigt:

* aktuelle Datei;
* Fortschritt;
* Warteschlange;
* erfolgreich abgeschlossene Uploads;
* Fehler mit verständlicher Ursache;
* erneuten Versuch, sofern implementiert.

Manueller Upload:

* Drag-and-drop;
* Dateiauswahl;
* verständliche Format- und Größenprüfung;
* Videodateien lokal ansehen, falls noch kein Server existiert.

Kennzeichne lokale Vorschauen ausdrücklich: „Nur in diesem Browser verfügbar – noch nicht auf dem Server gespeichert.“

Speichere große Videodateien nicht in localStorage. Räume Object-URLs auf, wenn sie nicht mehr gebraucht werden.

Geräteseite:

* verbundene PCs;
* letzter Kontakt;
* überwachte Ordner;
* Uploadstatus;
* Zuordnung von Ordnern zu Spielen.

Eine beispielhafte Ordnerzuordnung:

`D:\Clips\Valorant` → VALORANT

Falls kein Desktop-Agent existiert, verwende klar gekennzeichnete Beispieldaten. Zeige keinen vermeintlich funktionierenden Download- oder Kopplungsprozess.

Erkläre knapp den vorgesehenen Ablauf: Desktop-App installieren, Server verbinden, Aufnahmeordner auswählen.

## 13. Teilen

Ein Clip kann später über einen privaten Link erreichbar sein.

Dialog:

* Link erstellen;
* Ablaufdatum auswählen;
* Link kopieren;
* Link widerrufen.

Wichtig: Ein lokal gespeicherter Demo-Token ist keine echte öffentliche Freigabe und keine Zugriffskontrolle.

Ohne Backend:

* öffentliche Freigabe als noch nicht verfügbar kennzeichnen;
* bei Bedarf eine explizit benannte Vorschau der Freigabeseite anbieten;
* keine falsche Erfolgsmeldung über einen angeblich extern erreichbaren Link zeigen.

Die Freigabeansicht ist reduziert:

* dezente Marke;
* Player;
* Titel;
* Spiel;
* keine Navigation in die private Bibliothek.

## 14. Einstellungen

Übersichtliche Bereiche:

* Profil;
* Wiedergabe;
* Erscheinungsbild;
* Speicher;
* Geräte.

Sinnvolle Optionen:

* automatische stumme Vorschauen;
* Wiedergabegeschwindigkeit;
* reduzierte Bewegung;
* Speicherinformationen, sofern verfügbar.

Zeige nur Einstellungen als bedienbar an, die tatsächlich Auswirkungen haben. Serverfunktionen ohne Integration werden eindeutig als nicht verbunden dargestellt.

Speicherstatistiken müssen aus vorhandenen Daten berechnet oder als Demo-Werte gekennzeichnet sein.

## 15. Sprache und Produkttexte

Die Oberfläche ist auf Deutsch.

Schreibe kurze, konkrete Texte:

* „Zuletzt hinzugefügt“
* „Weiterschauen“
* „Deine Spiele“
* „Clip hochladen“
* „Zur Sammlung“
* „Noch keine Clips“
* „Keine Treffer“
* „Upload erneut versuchen“

Keine Marketingtexte innerhalb der Anwendung. Keine Entwicklerbegriffe wie „Mock Provider“, „API Adapter“ oder „Hydration“ im Nutzerinterface.

Eine kleine globale Kennzeichnung „Demo“ genügt für die Beispieldaten. An Aktionen mit realen Auswirkungen muss zusätzlich klar sein, was funktioniert und was noch keine Serververbindung hat.

## 16. Demo-Inhalte und Medien

Die Anwendung muss beim ersten Start überzeugend befüllt sein.

Erstelle mindestens:

* 18 unterschiedliche Clip-Datensätze;
* fünf Spiele;
* vier Sammlungen;
* mehrere Favoriten;
* drei begonnene Clips;
* sinnvolle Tags;
* unterschiedliche Aufnahmezeitpunkte.

Beispieltitel:

* „Das war der letzte Schuss“
* „Wir hatten einen Plan“
* „1 HP und trotzdem gewonnen“
* „Niemand hat die Granate gesehen“
* „Der sauberste Drift bisher“
* „Dieser Boss hatte andere Pläne“

Verwende konsistente, plausible Daten. Ein 30-Sekunden-Clip darf keinen Fortschritt von zwei Minuten haben.

Medien sind ein entscheidender Teil des Designs:

* verwende zuerst geeignete vorhandene Projekt-Assets;
* nutze rechtmäßig verfügbare Beispielmedien mit nachvollziehbarer Herkunft;
* keine zufälligen Stockfotos von Büros, Landschaften oder Personen;
* keine kaputten externen URLs;
* keine identische Vorschau für alle Clips;
* keine fremden Videos herunterladen, deren Nutzung unklar ist;
* keine KI-Bilder als echtes Gameplay ausgeben.

Falls Bildgenerierung verfügbar ist, können eigene illustrative Game-Motive für Demo-Cover entstehen. Diese ersetzen keine echten abspielbaren Clips.

Mindestens ein echter abspielbarer Beispielclip soll den vollständigen Player-Ablauf demonstrieren, sofern geeignetes Material verfügbar ist. Weise im Abschluss transparent auf fehlende Medien hin.

Wähle für den Hero das stärkste verfügbare Motiv und passe Bildausschnitt, Textposition und Verlauf daran an.

## 17. Datenmodell und Zustand

Definiere typisierte Modelle für:

* Clip;
* Game;
* Collection;
* Device;
* UploadJob;
* PlaybackProgress;
* UserPreferences.

Ein Clip enthält mindestens:

* ID;
* Titel;
* Spiel-ID;
* Thumbnail;
* optionale Videoquelle;
* Dauer;
* Aufnahmedatum;
* Dateigröße;
* Auflösung;
* Tags;
* Favoritenstatus;
* Verarbeitungsstatus.

Leite Listen und Zähler aus einer zentralen Datenquelle ab. Vermeide getrennte, widersprüchliche Kopien desselben Clips auf verschiedenen Seiten.

Trenne:

* UI-Komponenten;
* Seiten;
* Datenzugriff;
* Domain-Modelle;
* Demo-Inhalte;
* persistierten Nutzerzustand.

Persistiere in der Demo:

* Favoriten;
* Titeländerungen;
* Sammlungen;
* Tags;
* Wiedergabefortschritt;
* Einstellungen.

Demo-Daten dürfen nicht bei jedem Rendern oder Neuladen Nutzeränderungen überschreiben. Biete in den Einstellungen eine ausdrücklich benannte Funktion zum Zurücksetzen der Demo an.

## 18. Interaktionen

Jedes sichtbare interaktive Element hat eine tatsächliche Funktion.

Beispiele:

* Spielkarte öffnet die nach Spiel gefilterte Bibliothek.
* „Alle anzeigen“ öffnet die passende Ansicht.
* Favorisieren aktualisiert alle betroffenen Stellen.
* Suchergebnisse reagieren auf die Eingabe.
* Clip-Karte öffnet den richtigen Clip.
* Sammlung enthält die ausgewählten Clips.
* Kontextmenüs sind bedienbar.
* Dialoge schließen per Escape.
* Zurücknavigation erhält möglichst Filter und Scrollposition.

Keine leeren Click-Handler. Keine Erfolgstoasts für nicht durchgeführte Aktionen.

Destruktive Aktionen benötigen eine klare Bestätigung oder eine zuverlässig funktionierende Rückgängig-Funktion.

## 19. Zustände

Gestalte auch:

* leere Bibliothek;
* leere Sammlung;
* keine Suchtreffer;
* fehlendes Thumbnail;
* nicht abspielbares Format;
* fehlende Videodatei;
* Uploadfehler;
* Server nicht erreichbar;
* Verarbeitung läuft;
* ungültige Clip-ID;
* unbekannte Route.

Skeletons orientieren sich an der tatsächlichen Inhaltsstruktur. Füge keine künstlichen Wartezeiten hinzu, nur um Ladeanimationen zu zeigen.

Fehlertexte erklären das Problem und nennen eine tatsächlich verfügbare nächste Aktion.

## 20. Animation und Bedienqualität

Animationen unterstützen die Orientierung:

* kurze Hover-Übergänge;
* weiches Öffnen von Menüs und Dialogen;
* dezenter Wechsel zwischen Ansichten;
* ruhige Fortschrittsanimationen.

Richtwert: etwa 120–220 Millisekunden für kleine Interaktionen.

Keine dauerhaft schwebenden Elemente, übertriebenen Bounces oder Scroll-Effekte, die die Bedienung erschweren.

Respektiere `prefers-reduced-motion`.

Horizontal scrollende Reihen:

* Touch und Trackpad unterstützen;
* Desktop-Pfeile nur bei vorhandenem Überlauf;
* keine abgeschnittenen Fokusrahmen;
* keine unbeabsichtigte horizontale Bewegung der gesamten Seite.

## 21. Responsive Design und Barrierefreiheit

Prüfe mindestens:

* 390 Pixel;
* 768 Pixel;
* 1440 Pixel;
* 1920 Pixel.

Auf kleinen Displays:

* Navigation reduzieren;
* Filter in ein gut bedienbares Panel verschieben;
* wichtige Aktionen sichtbar halten;
* Player ohne überlagerte Controls;
* ausreichend große Touch-Flächen;
* Dialoge dürfen zu Bottom Sheets werden.

Außerdem:

* semantische Buttons und Links;
* beschriftete Icon-Buttons;
* sichtbarer Tastaturfokus;
* korrektes Fokusmanagement in Dialogen;
* sinnvolle Überschriftenhierarchie;
* Statusinformationen nicht ausschließlich durch Farbe;
* dekorative Bilder ohne unnötige Screenreader-Ausgabe.

## 22. Performance

* Lade Bilder unterhalb des sichtbaren Bereichs verzögert.
* Reserviere Bildflächen über feste Seitenverhältnisse.
* Lade keine vollständigen Videos für jede Karte.
* Beschränke Video-Preloads.
* Stoppe nicht sichtbare Vorschauen.
* Verwende passende Thumbnail-Größen.
* Vermeide unnötige Re-Renders.
* Lade umfangreiche Ansichten bei Bedarf nach.
* Behalte Nutzerzustand bei Navigation.

Die Anwendung soll auch mit einer größeren Bibliothek strukturell funktionieren. Eine vollständige Optimierung für hunderttausende Clips gehört nicht in diese erste Phase.

## 23. Visuelle Qualitätskontrolle

Beurteile das tatsächliche Ergebnis im Browser.

Prüfe:

1. Wirkt die erste Bildschirmansicht wie eine hochwertige Streaming-App?
2. Sind Gameplay-Motive stärker als die umgebende Oberfläche?
3. Ist der Hero lesbar und sauber komponiert?
4. Ist bereits weiterer Inhalt sichtbar?
5. Stimmen Abstände, Radien und Typografie über alle Seiten überein?
6. Sind Navigation und Aktionen sofort verständlich?
7. Wirken Karten hochwertig, ohne überladen zu sein?
8. Ist die mobile Ansicht bewusst gestaltet?
9. Gibt es überlagerte Texte, abgeschnittene Menüs oder leere Bildflächen?
10. Sind Demo-Funktionen ehrlich gekennzeichnet?

Verbessere erkannte Schwächen vor dem Abschluss. Beschränke dich nicht darauf, dass die Anwendung technisch rendert.

## 24. Verifikation

Führe die vorhandenen relevanten Prüfungen aus:

* Typecheck;
* Lint, sofern eingerichtet;
* Produktionsbuild;
* zentrale Interaktionsprüfungen.

Prüfe besonders:

* Suche zusammen mit Filtern;
* Favoriten nach Neuladen;
* Sammlung erstellen und Clip hinzufügen;
* direkte Navigation auf eine Clip-URL;
* Player und Fortschritt;
* mobile Menüs;
* lokale Dateivorschau;
* Fehler bei fehlenden Medien.

Schreibe gezielte Tests für relevante Zustandslogik. Vermeide Tests, die lediglich Markup oder Implementierungsdetails spiegeln.

Falls Browserprüfung oder Medienbeschaffung nicht möglich sind, benenne diese konkrete Einschränkung. Behaupte keine durchgeführten Prüfungen.

## 25. Fertigstellung

Das Ergebnis soll lokal startbar und als zusammenhängendes Produkt erlebbar sein.

Liefere:

* implementierte Weboberfläche;
* funktionierende Navigation;
* hochwertige Startseite;
* Bibliothek mit Suche und Filtern;
* Clip-Ansicht mit Player;
* persistierende Favoriten und Sammlungen;
* ehrliche Upload- und Geräteansichten;
* responsive Gestaltung;
* kurze Startanleitung;
* knappe Übersicht noch fehlender Backend-Funktionen.

Veröffentliche oder deploye die Anwendung nur bei entsprechender ausdrücklicher Beauftragung.

Beginne jetzt mit der Prüfung des Projekts und setze ReplayHaven um. Priorisiere zuerst die visuelle Qualität von Startseite, Clip-Karten und Player. Übertrage dieses Niveau anschließend konsistent auf die restlichen Ansichten.

## 26. Open-Source-Repository, Betrieb und Arbeitsteilung

ReplayHaven wird als öffentliches Repository gepflegt. Diese Regeln gelten für alle Beiträge, auch für KI-Agenten.

Auslieferung:

* Server als Docker-Image `ghcr.io/<owner>/replayhaven`, mehrarchitekturfähig (amd64, arm64). Nutzer brauchen nur `compose.yaml` und eine `.env`; `setup-server.sh` deckt Einrichtung und Build aus dem Quellcode ab.
* Windows-Client als NSIS-Installer `ReplayHaven-Client-Setup.exe` in den GitHub-Releases. Der Server verweist unter „Geräte“ auf einen lokal abgelegten Installer oder auf `REPLAYHAVEN_CLIENT_DOWNLOAD_URL`.
* Ein Git-Tag `vX.Y.Z` löst den Release-Workflow aus: Installer, Image, gepinnte Compose-Datei, Prüfsummen.
* Konfiguration ausschließlich über Umgebungsvariablen (`.env.example`). Keine persönlichen Adressen, Gerätenamen oder Hardwarebezeichnungen im Code oder in der Dokumentation.

Qualität:

* CI prüft Typen, Lint, Formatierung, Unit-Tests, Browser-Tests, Docker-Build mit Container-Smoke-Test und den entpackten Windows-Client.
* Lizenz MIT für den Quellcode. Demo-Medien und gebündelte FFmpeg-Builds unterliegen eigenen Bedingungen (`THIRD-PARTY.md`).
* Oberflächentexte bleiben deutsch; Code, Kommentare, Commit-Nachrichten und Entwicklerdokumentation sind englisch.

Arbeitsteilung:

* Die Weboberfläche unter `src/` wird in einem eigenen Design-Durchgang nach den Abschnitten 3 bis 23 gestaltet. Arbeiten an Server, Client, Build, Betrieb und Dokumentation dürfen die Weboberfläche nicht umgestalten und nur streng technische Anpassungen daran vornehmen.
* Produktregeln aus Abschnitt 2 gelten uneingeschränkt: Originale bleiben unangetastet, Fähigkeiten werden nicht vorgetäuscht, Serverfunktionen ohne Verbindung werden ehrlich gekennzeichnet.
