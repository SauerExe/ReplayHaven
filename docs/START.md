# ReplayHaven einrichten

Dein Gaming-PC übernimmt die KI-Analyse. Dein Server speichert Videos und Ergebnisse und stellt das Archiv im Browser bereit. Auf dem Server ist dafür weder ein KI-Modell noch ein Grafiktreiber nötig.

## 1. Server einrichten

Voraussetzung: ein Linux-Rechner, NAS oder Mini-PC mit [Docker Engine und Compose-Plugin](https://docs.docker.com/engine/install/).

**Variante A – fertiges Image (empfohlen):**

```bash
mkdir -p replayhaven && cd replayhaven
curl -fsSLO https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/compose.yaml
curl -fsSL  https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/.env.example -o .env
nano .env        # REPLAYHAVEN_ACCESS_TOKEN und REPLAYHAVEN_PUBLIC_ORIGIN eintragen
docker compose up -d
```

Den Zugangsschlüssel erzeugst du mit `openssl rand -hex 24`. Als Serveradresse trägst du genau das ein, was du später im Browser öffnest, zum Beispiel `http://192.168.1.20:8787`.

**Variante B – aus dem Quellcode:**

```bash
git clone https://github.com/SauerExe/ReplayHaven.git
cd ReplayHaven
bash setup-server.sh
```

Das Skript fragt die Serveradresse ab, erzeugt den Zugangsschlüssel, baut das Image und startet den Server. Der erste Build braucht Internet und einige Minuten.

Danach die Serveradresse im Browser öffnen → **Einstellungen → KI & Server** → Schlüssel eingeben. Unter **Geräte** steht anschließend der Windows-Download bereit.

## 2. Windows-Client einrichten

1. `ReplayHaven-Client-Setup.exe` installieren und ReplayHaven Client öffnen. Node.js, Python oder FFmpeg musst du nicht gesondert installieren.
2. Den Aufnahmeordner auswählen. Unterordner werden mitgenommen.
3. Serveradresse und Zugangsschlüssel eintragen.
4. **Ollama installieren** öffnet den offiziellen Download. Ollama installieren und starten, dann im Client **Verbindung prüfen** klicken.
5. **Modell laden** lädt einmalig Qwen3.5 9B, ungefähr 6,6 GB. Das geschieht ausschließlich auf deinen Klick.
6. Mit **24 Bildern** beginnen und **Analyse & Upload starten** klicken.

Aktiviere **Vorhandene Aufnahmen beim ersten Start mitnehmen**, bevor du erstmals startest, wenn du alte Clips ebenfalls importieren möchtest. Sonst werden sie als übersprungen vorgemerkt. Diese Auswahl gilt pro Aufnahmeordner und Server. Der Spielname ist optional; ohne Eingabe dient der Unterordnername als Hinweis für die KI.

Unter **Deine Spielernamen** trägst du ein, wie du im Spiel heißt. Heißt du je Spiel anders, bekommt jeder Name sein Spiel; vorgeschlagen werden die Spielordner deiner Aufnahmen, damit Eintrag und Ordner zusammenpassen. Ein Name ohne Spiel gilt überall. Die KI erfährt nur die Namen, die zum Spiel des Clips passen, und erkennt daran im Killfeed, welche Seite deine ist.

Der Installer ist derzeit nicht mit einem Herausgeberzertifikat signiert. Windows SmartScreen fragt deshalb einmal nach.

## 3. Wie bisher aufnehmen

Speichere deine Clips wie gewohnt, etwa die letzten zwei Minuten über die NVIDIA App. Nach mindestens zehn Sekunden ohne Dateiänderung analysiert der Client die Aufnahme. Danach überträgt er **Originalvideo und Ergebnis**. Der Clip erscheint automatisch im Archiv. Titel, Beschreibung und Tags sind bearbeitbar; Zeitmarken springen zur Videostelle.

Beim Spielen kannst du **pausieren** und anschließend mit **Analyse & Upload starten** fortsetzen. Ein gerade laufender FFmpeg-Schritt kann noch zu Ende laufen. Schließen lässt den Client im Windows-Infobereich weiterlaufen; **Beenden** im Tray-Menü beendet ihn. Nach einem Windows-Neustart startest du den Client erneut. Automatischer Windows-Start ist noch nicht eingerichtet.

Zum ersten Verbindungstest kannst du **Neue Clips vor dem Upload lokal analysieren** ausschalten. Dann werden Originale ohne KI-Ergebnis archiviert; Ollama ist dafür nicht erforderlich. Beim manuellen Browser-Upload wird die PC-KI ebenfalls nicht aufgerufen.

## Fortnite-Replays (optional)

Fortnite legt von jedem Match ein Replay unter `%LOCALAPPDATA%\FortniteGame\Saved\Demos` ab. Mit **Fortnite-Replays einbeziehen** liest der Client daraus deine Kills, Knocks, dein Ausscheiden und einen Sieg samt Waffenart und Entfernung, statt sie aus Bildschirmmeldungen zu lesen. So entstehen Titel wie „Doppel-Kill mit der Schrotflinte“ oder „Snipe über 180 m“.

- Die Clipzeit ergibt sich aus der Uhrzeit im NVIDIA-Dateinamen und dem Zeitpunkt, zu dem die Datei geschrieben wurde. Originale werden dafür nur gelesen.
- Ein Replay nennt nicht, wer aufgenommen hat. Der Client erkennt dein Konto daran, dass es in fast jedem Replay dieses PCs vorkommt, und an der Match-Statistik. Bleibt es unklar, nutzt er das Replay nicht. Eindeutig wird es, wenn du deine **Epic-Konto-ID** einträgst; sie steht auf epicgames.com in deinen Kontoeinstellungen.
- Spielst du Duos oder Squads mit festen Mitspielern, kommen sie in denselben Replays vor wie du. Dann wählt der Client in Teammatches kein Konto, statt womöglich ihre Kills als deine zu zählen. Trag in dem Fall deine Epic-Konto-ID ein.
- Ein Clip aus einem Match, das noch läuft, wartet bis zu dessen Ende, höchstens 45 Minuten. Danach wird er wie bisher nur mit Bildern analysiert.
- In Fortnite muss die Aufzeichnung von Replays eingeschaltet sein. Der Client liest nur den Kopf und die Ereignisse eines Replays, nicht das ganze Match.

## Texterkennung: R6-Karte, Rundenausgang und Valorant-Killfeed (optional)

Mit **Texterkennung: R6-Karte und Rundenausgang, Valorant-Killfeed** liest der Client in R6-Clips zwei Bilder je Sekunde mit einer Texterkennung (PaddleOCR über ONNX Runtime, auf der CPU). Daraus nimmt er den Kartennamen und Rundenergebnisse wie „ROUND WON“, sodass Titel wie „Rundensieg auf Oregon“ möglich werden.

- Eine Karte zählt erst, wenn sie in mindestens zwei Bildern sicher gelesen wurde. Ein Titel darf dann keine andere Karte nennen.
- In R6 liest die Texterkennung Kills bewusst nicht. Wer eine Killfeed-Zeile verursacht hat und ob sie zum Clip gehört, ließ sich so nicht verlässlich klären.
- In Valorant liest sie nur den Killfeed oben rechts. Steht einer deiner eingetragenen Valorant-Namen links in einer Zeile, ist es dein Kill, steht er rechts, dein Tod; das Kopfschuss-Symbol wird meist mitgelesen. Trag jeden Namen ein, unter dem du je gespielt hast, sonst bleiben Clips aus dieser Zeit ohne Kills. Kills und Tode aus dem Killfeed ersetzen dann die, die die KI aus Bildschirmtexten gedeutet hat. Das dauert etwa 15 bis 25 Sekunden CPU je Clip.
- Die Texterkennung braucht etwa eine Minute CPU-Zeit je Clip. Sie läuft gleichzeitig mit der KI, die auf der Grafikkarte rechnet, in einem eigenen Thread, damit das Fenster nicht stockt, und nutzt höchstens die Hälfte der Prozessorkerne.
- Sie nutzt ONNX Runtime von Microsoft. Deren Windows-Fassung enthält Telemetrie-Ereignisse (ETW). Laut Datenschutzhinweis des Projekts werden sie nur aufgezeichnet, wenn eine Trace-Sitzung läuft, und nur mit deiner Zustimmung zu den Windows-Diagnosedaten übertragen.

## Voice-Chat mitschreiben (optional)

Mit **Voice-Chat mitschreiben (Spaßclips)** schreibt der Client mit, was im Clip gesagt wird, und gibt es der KI als Kontext. Clips ohne Kills oder Rundenergebnis bekommen so Titel nach dem Gespräch, etwa „Obi-Wan oder Yoda?“ statt „Spitzhacke am Eiszaun“.

- Die Erkennung läuft mit Parakeet TDT 0.6B v3 über sherpa-onnx auf der CPU, in einem eigenen Prozess neben der KI. Zwei Minuten Ton dauern wenige Sekunden.
- Beim ersten Start mit der Option lädt der Client die Sprachmodelle einmalig nach `%LOCALAPPDATA%ReplayHavenmodelsparakeet-v3`, rund 670 MB, jede Datei gegen ihre Prüfsumme geprüft.
- Hat die Aufnahme eine eigene Mikrofonspur (NVIDIA App: „Mikrofon als separate Spur“), hört der Client nur diese. Sonst liest er die gemischte Spur; laute Spielgeräusche verschlucken dann einzelne Wörter.
- Englische Namen im deutschen Gespräch verhört das Modell gelegentlich. Zitate landen deshalb nicht wörtlich im Titel.
- Das Transkript bleibt auf deinem PC; zum Server gehen wie bisher nur Titel, Beschreibung, Tags und Zeitmarken.

## Was tatsächlich passiert

- Die lokale KI erhält 24 oder 48 verkleinerte Einzelbilder in aufeinanderfolgenden Paketen. **Ton wird nicht analysiert.** Schnelle Ereignisse können zwischen den Bildern liegen; Ergebnisse sind Vorschläge.
- Im voreingestellten Modus werden keine Aufnahmen an einen Cloud-KI-Anbieter gesendet.
- Der Server bekommt das unveränderte Original einschließlich eventuell aufgenommenem Ton. Er erstellt ein Thumbnail und bei Bedarf eine H.264-Wiedergabekopie.
- Nimmt die NVIDIA App das Mikrofon als eigene Spur auf („Mikrofon als separate Spur“), mischt die Wiedergabekopie alle Tonspuren. Ein Browser spielt sonst nur die erste Spur, und deine Stimme fehlt. Weitere Spuren kommen mittig in die Mischung, auch wenn das Mikrofon nur auf einem Kanal liegt. Das Bild wird dabei nur kopiert, das Original behält die getrennten Spuren.
- Auf dem PC werden Originale weder umbenannt noch verschoben oder gelöscht. Der KI-Titel ist der Anzeigename im Archiv.
- Nach Verbindungsfehlern wird erneut versucht. Fertige Analysen bleiben bis zur Bestätigung zwischengespeichert. Der Server erkennt doppelte Dateien anhand ihres Inhalts.
- **Aus Bibliothek entfernen** blendet den Eintrag aus; seine Originaldatei bleibt auf dem Server. Eine automatische Speicherbereinigung gibt es noch nicht.
- Metadaten und Favoriten eigener Server-Clips liegen auf dem Server. Sammlungen, Wiedergabefortschritt und Anzeigeeinstellungen bleiben derzeit im jeweiligen Browser.

## Fehler beheben

| Problem                                   | Nächster Schritt                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Server nicht erreichbar                   | Adresse im Browser prüfen; auf dem Server `docker compose ps` und `docker compose logs --tail=80` ausführen.                              |
| „Diese Herkunft ist nicht freigegeben“    | `REPLAYHAVEN_PUBLIC_ORIGIN` in `.env` muss genau der Browseradresse entsprechen. Danach `docker compose up -d`.                           |
| Schlüssel falsch                          | Den Schlüssel erneut eingeben. Er steht auf dem Server in `.env`.                                                                         |
| Ollama nicht erreichbar                   | Ollama unter Windows starten, dann **Verbindung prüfen**.                                                                                 |
| Modell fehlt                              | **Modell laden** wählen und warten.                                                                                                       |
| GPU-Speicher knapp / Spiel ruckelt        | Client pausieren und nach dem Spielen fortsetzen. Mit 24 Bildern beginnen. Während der Analyse zeigt `ollama ps` die GPU-Nutzung.         |
| Datei bleibt ausstehend                   | Warten, bis die Aufnahme fertig geschrieben ist. Unterstützt: MP4, M4V, MOV, WebM, MKV; maximal 2 GB, 30 Minuten und 8K pro Aufnahme.     |
| Fortnite-Clip bleibt ausstehend           | Er wartet auf das Ende seines Matches. Nach dem Match oder spätestens nach 45 Minuten geht es weiter.                                     |
| Start meldet „Visual C++ Redistributable“ | Die R6-Texterkennung braucht sie. Die aktuelle x64-Fassung von Microsoft installieren und erneut starten, oder die R6-Option ausschalten. |
| Kein KI-Titel                             | Prüfen, ob die Client-Analyse aktiv war. Bereits archivierte Dateien werden durch späteres Einschalten nicht automatisch nachanalysiert.  |
| Kein Windows-Download unter Geräte        | Das Image kennt keine Download-Adresse. `REPLAYHAVEN_CLIENT_DOWNLOAD_URL` in `.env` setzen oder den Installer nach `release/` legen.      |

## Grenzen

Modellqualität, Geschwindigkeit und Grafikspeicherbedarf hängen von deiner Hardware ab. Qwen3.5 9B läuft auf Grafikkarten ab etwa 10 GB VRAM flüssig; ohne passende GPU rechnet Ollama auf der CPU und braucht deutlich länger. Prüfe nach der Einrichtung mit einem echten Clip: Server starten → Client verbinden → neue Aufnahme speichern → GPU-Auslastung beobachten → Ergebnis im Archiv prüfen → Original herunterladen.

Weiterführend: [Serverbetrieb](SERVER.md), [Entwicklung](../README.md), [Qwen3.5 bei Ollama](https://ollama.com/library/qwen3.5:9b), [Ollama GPU-Unterstützung](https://docs.ollama.com/gpu).
