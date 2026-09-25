# Konzept: Erkennung für alle Spiele

**Ziel.** Titel, Tags und Zeitmarken sollen in jedem Spiel stimmen, nicht nur in Fortnite und Rainbow Six. Heute liest die KI Bildschirmmeldungen aus 24 oder 48 Bildern und fester Code deutet sie; exakt wird es nur dort, wo ein Replay (Fortnite) oder die Texterkennung (R6) dazukommt. Dieses Konzept ordnet, woher belegte Ereignisse für die übrigen Spiele kommen können, was am Bild- und Tonweg messbar besser wird und in welcher Reihenfolge sich das lohnt.

Grundlage ist eine Recherche vom 2026-09-24 (Quellen am Ende). Gemessen ist davon nichts; jede Stufe endet deshalb mit einem Messschritt, wie in `MESSPLAN.md`. Was nur aus zweiter Hand stammt, ist als _unbestätigt_ markiert.

## Was schon da ist

- `server/media.ts`: ffmpeg zieht Bilder mit 1280 px Breite, zwei Drittel aus den letzten 30 Sekunden.
- `agent/ollama.ts`: Qwen3-VL 8B ordnet je vier Bilder ein (Spielansicht, Ergebnis, Menü, Ladebild, Respawn) und schreibt Meldungen wörtlich ab; jedes Bild trägt seinen Zeitpunkt als Text, so wie das Modell trainiert ist.
- `agent/events.ts`: fester Code deutet die Meldungen zu Kills, Toden, Runden- und Matchergebnissen; das Modell deutet nicht selbst.
- `agent/fortnite.ts`, `agent/r6.ts`: exakte Quellen, die gelesene Ereignisse ersetzen.
- `agent/laughs.ts`, `TON-KONZEPT.md`: Lacher und Rufe aus der Mikrofonspur als Messwerkzeug, noch nicht in der Analyse.
- Der Spielname kommt aus dem Ordner der Aufnahme und gilt als unzuverlässig.

## Das Prinzip: Quelle vor Bild, Bild vor Vermutung

Alles, was Titel und Tags tragen sollen, braucht eine Rangfolge der Belege, und die Analyse nimmt je Ereignis den höchsten verfügbaren:

1. **Spieldaten.** Replay, Demo, lokale Spiel-API oder die Marker der Steam-Aufnahme. Exakt, mit Zeit, Waffe, Gegner.
2. **Bildschirmtext.** Texterkennung auf festen HUD-Bereichen, gedeutet von Code, wie heute bei R6.
3. **Ton.** Lautstärkespitzen, Lacher, Ansagen des Spiels, Transkript.
4. **Beschreibung durch die KI.** Nur noch, was keine der drei Quellen liefert: was zu sehen ist, wie es wirkt, ein Titel in Spielersprache.

Die Studien zu Highlight-Erkennung in Spielvideos sind sich darin einig, dass Ton das stärkste einzelne Signal ist und ein Bildmodell schlecht darin, Ereignisse in einem Video zeitlich zu verorten (VideoGameQA-Bench: das beste Modell fand 36 % der gesuchten Stellen). Die KI soll deshalb Kandidaten benennen, nicht finden.

## Stufe 1: Welches Spiel

Der Spielname entscheidet, welche Quellen, HUD-Bereiche und Ansagen gelten. Drei Wege, vom sichersten zum unsichersten:

- **Dateiname und Ablage.** NVIDIA App schreibt `[Spiel] JJJJ.MM.TT - HH.MM.SS.ii.DVR.mp4` in `Videos\<Spiel>\` und setzt am Dateiende die Marke `EncodedBy = "GeForce SHARE"`. Game Bar schreibt den Spielnamen mit Datum in den Dateinamen. Steam-Aufnahmen tragen die App-ID im Ordner- und Zeitachsennamen (`bg_<appid>_…`, `timeline_<appid>…json`); `appmanifest_<appid>.acf` liefert den Namen. OBS schreibt nichts in den Dateinamen; hier hilft nur das Protokoll in `%APPDATA%\obs-studio\logs\` (welchen Prozess Game Capture gehakt hat) oder der nächste Punkt.
- **Vordergrundprozess beim Speichern.** Der Client läuft ohnehin, während gespielt wird. `get-windows` liefert Titel, Prozessname und Pfad des aktiven Fensters; ein Abgleich gegen die Installationsordner aus Steams `libraryfolders.vdf` und `appmanifest_*.acf` sowie den Epic-Manifesten in `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item` ergibt den Spielnamen. Merkt sich der Client je Aufnahme, was beim Entstehen der Datei im Vordergrund war, ist der Ordnername nur noch Rückfall.
- **Bildvergleich.** Für Aufnahmen ohne beides: SigLIP-2-Einbettungen der Bilder gegen eine Referenzbank aus den eigenen, schon zugeordneten Clips (k-nächste Nachbarn). Ein Textvergleich mit Spielnamen ohne Referenzbilder verwechselt ähnliche Shooter, _unbestätigt_, deshalb nur als letzter Weg.

## Stufe 2: Exakte Ereignisse je Spiel

Was lokal und ohne Konto lesbar ist, kommt zuerst. Alles Übrige bleibt Option mit eigener Zustimmung.

| Spiel                                                                                 | Quelle                                                                                    | Liefert                                                        | Werkzeug                                                                     | Stand                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Fortnite                                                                              | `.replay` in `%LOCALAPPDATA%\FortniteGame\Saved\Demos`                                    | Kills, Knocks, Sieg, Waffe, Entfernung                         | eigener Parser; Referenz Shiqan/FortniteReplayDecompressor (v3.0.1, .NET 10) | eingebaut; Format ändert sich je Version                                                |
| Rainbow Six                                                                           | Match-Replays                                                                             | Karte, Runden, Kills, Rundenuhr                                | r6-dissect                                                                   | eingebaut                                                                               |
| Counter-Strike 2                                                                      | `.dem` (GOTV, muss aus dem Matchverlauf geladen werden) + Steam-Timeline-Marker           | Kills, Waffe, Runden, Bombe                                    | demoparser2 (Rust mit Node-Bindings), deadem (reines JS)                     | machbar; Download automatisieren oder Steam-Aufnahme nutzen                             |
| Steam-Aufnahme                                                                        | `Steam\userdata\<id>\gamerecordings\`: `timeline_*.json`, `clip.pb`                       | Marker der Spiele (CS2, Dota 2 bestätigt), Erfolge in allen    | protobuf ohne Schema; Vorbild SteamRecordingYouTubeUploader                  | machbar; Steam zählt Mehrfachkills unzuverlässig, Einzelereignisse selbst zählen        |
| Rocket League                                                                         | `.replay` in `Documents\My Games\Rocket League\TAGame\Demos`                              | Tore, Highlights mit Bildnummer (`RecordFPS`)                  | rrrocket / boxcars (Rust, auch WASM)                                         | machbar                                                                                 |
| Dota 2                                                                                | `.dem`, nur nach Download im Spiel                                                        | alles                                                          | deadem (JS), manta (Go)                                                      | machbar                                                                                 |
| League of Legends                                                                     | Live Client Data API `https://127.0.0.1:2999/liveclientdata/eventdata` während des Spiels | ChampionKill, Multikill, Ace, Drachen, Baron, Türme, Spielende | eigener Poller mit Uhrzeit je Ereignis                                       | machbar; `.rofl` ist seit 13.20 ohne Statistik, Replay-API steuert nur die Kamera       |
| Valorant                                                                              | `match-details` über Token des lokalen Clients (inoffiziell)                              | Kill-Log mit Millisekunden, Waffe, Headshot                    | techchrism-Dokumentation                                                     | Grauzone: Riot verlangt Registrierung jedes Produkts, erlaubt Auswertung nach dem Spiel |
| PUBG                                                                                  | Developer-API, Telemetrie je Match                                                        | `LogPlayerKillV2`, `LogPlayerMakeGroggy`, Matchstart           | API-Schlüssel                                                                | nur mit Konto                                                                           |
| Halo Infinite                                                                         | Waypoint-API, Theater-Filme                                                               | Highlights mit Zeitstempel                                     | SPNKr (Python)                                                               | nur mit Xbox-Live-Anmeldung                                                             |
| Destiny 2                                                                             | Bungie-API, Post Game Carnage Report                                                      | Kills, Medaillen, ohne Zeitstempel                             |                                                                              | nur für Titel, nicht für Zeitmarken                                                     |
| Minecraft, Warframe, Tarkov                                                           | `latest.log`, `EE.log`, Spielprotokolle                                                   | Chat, Tod, Missions- und Raidgrenzen, Karte                    | warframe-deathlog, TarkovMonitor                                             | grob, keine Kills mit Zeit (Tarkov: nur Karte)                                          |
| Apex, CoD/Warzone, Overwatch 2, Marvel Rivals, The Finals, Battlefield 6, Hunt, GTA V | nichts Lesbares                                                                           |                                                                |                                                                              | nur Bild und Ton                                                                        |

Overwolf liefert für über 60 Spiele Ereignisse in Echtzeit, aber nur an Apps auf der Overwolf-Plattform. Medal, Outplayed und Co. leben genau davon; für eine eigene Electron-App ist das kein Weg.

**Einbau.** Jede Quelle ist ein Modul wie `agent/fortnite.ts`: ein Nachschlagen mit Pfad, Spiel und Dauer, das Ereignisse mit Clip-Sekunde liefert oder `none` sagt, und `withReplay` bleibt die eine Stelle, die gelesene Ereignisse ersetzt. Die Zuordnung Clip zu Match läuft überall über die Uhrzeit: Dateizeit der Aufnahme gegen Matchstart, wie bei Fortnite. Für LoL muss der Client den Poller starten, sobald das Spiel im Vordergrund ist, und die Ereignisse mit Uhrzeit ablegen.

## Stufe 3: HUD lesen statt raten

Das Bildmodell sieht je 32 Pixel Bildkante ein Token. Bei 1280 px Breite ist eine zwölf Pixel hohe Killfeed-Zeile weniger als ein halbes Token hoch. Das ist der Grund, warum kleine Meldungen fehlen oder falsch gelesen werden, nicht das Modell.

- **Texterkennung aufrüsten.** PP-OCRv4 ist zwei Generationen alt. PP-OCRv5 erkennt auf dem Testsatz des Projekts 84 % statt 57 % der Texte (Server-Modell), PP-OCRv6 (PaddleOCR 3.7, Juni 2026) legt nochmals gut fünf Punkte zu, ist als ONNX veröffentlicht und auf Anzeigen und Displays trainiert. Der Tausch der Modelle in `agent/ocr.ts` ist der billigste Gewinn im ganzen Konzept. Ob das v6-Erkennungsmodell dieselbe Eingabeform und Wörterbuchdatei wie v4 nutzt, ist _unbestätigt_ und vorab zu prüfen.
- **Ausschnitte statt Vollbild.** Killfeed (meist oben rechts) und Mitte (Ergebnisbanner) in Originalauflösung ausschneiden, auf das Doppelte vergrößern und getrennt lesen; das Vollbild geht klein an die KI für die Bildart. CropVLM misst für gezielte Ausschnitte +7,5 Punkte auf TextVQA und +14,9 auf DocVQA gegenüber dem Vollbild; ein Praxistest mit Gemma 4 auf Spielbildern las Details in 256-px-Ausschnitten in 7 von 7 Fällen, im Vollbild in 5 von 7.
- **HUD-Profile je Spiel.** Eine kleine Datei je Spiel: Bereiche für Killfeed und Banner, die Ergebnisphrasen in Deutsch und Englisch, Teamfarben, Lage des Waffensymbols. Wer im Killfeed vor dem Symbol steht, hat getötet; das entscheidet Geometrie und Farbe, nicht die KI. Genau daran scheitert sie heute (E14, E17). Profile sind Textdateien, die andere beisteuern können; crispy und valoscribe machen es für Valorant, CS2, Overwatch und LoL vor. Stellt ein Nutzer sein HUD um, greift das Profil nicht; dann bleibt der bisherige Weg.
- **Stehende Einblendungen entdoppeln.** Ein Killfeed-Eintrag bleibt Sekunden sichtbar und taucht in mehreren Bildern auf. NVIDIAs Studie zur Annotation von Spielvideos nennt genau das als Fehlerquelle: ein alter HUD-Zustand wird als neues Ereignis gezählt. Gleicher Text innerhalb weniger Sekunden ist ein Ereignis.
- **Fein-Tuning nur hier.** Das Erkennungsmodell der Texterkennung auf HUD-Schriften nachzutrainieren, oder ein winziges YOLO für Killfeed-Zeilen, braucht ein paar hundert beschriftete Ausschnitte und keine Änderung an Ollama. Das Bildmodell selbst nachzutrainieren lohnt nicht: Ollama lädt keine eigenen Modelle mit getrenntem Bildprojektor, nur llama.cpp könnte das.

## Stufe 4: Ton als Signal

`TON-KONZEPT.md` beschreibt Lacher und Zitate für Spaßclips. Ton trägt aber mehr:

- **Lautstärke als Kandidatensuche.** RMS- und Spitzenwerte der Mikrofonspur mit ffmpeg `astats` oder `ebur128`, dann z-Werte je Sekunde. Wo die Stimme ausschlägt, ist der Moment. Das ersetzt das feste Schlussfenster: die Bilder gehen dorthin, wo Ton und Bildschnitt Spitzen zeigen, das letzte Drittel bleibt nur Rückfall.
- **Ansagen des Spiels.** „Ace“, „Clutch“, „Victory“, Killsounds sind feste Dateien, jedes Mal identisch. Für sie ist ein Audio-Fingerabdruck (nach Art von dejavu) sicherer als Spracherkennung; Zero-Shot mit CLAP („shouting“, „gunshot“, „explosion“) als Ergänzung. Einen fertigen Ansagen-Klassifikator gibt es nicht; die Sammlung je Spiel ist Handarbeit.
- **Transkript als Kontext.** Parakeet-TDT-0.6B-v3 versteht Deutsch (FLEURS 5,0 % Wortfehler) und Englisch, mit Wortzeiten, Lizenz CC-BY, läuft über das sherpa-onnx-Addon in Node; Qwen3-ASR 0.6B ist die Alternative, Whisper bleibt möglich. Callouts, Namen und Reaktionen im Voice-Chat machen Titel konkret; Zitate gehören wie im Ton-Konzept nur in die Beschreibung.
- **Nicht warten.** Ollama nimmt keinen Ton entgegen und hat keine Zusage dazu. Ton wird als Text an die KI gereicht.

## Stufe 5: Bilder klüger wählen

- **Bündel statt Raster.** Drei bis fünf Bilder mit 1 bis 2 Bildern je Sekunde um jede Ton- und Schnittspitze, dazu ein dünnes Raster über den ganzen Clip. Einzelbilder verpassen Bewegung; kurze Bündel zeigen den Ablauf eines Kills (F2C misst bis zu +8 Punkte gegenüber gleichmäßigem Raster bei gleicher Tokenzahl).
- **Schnitte erkennen.** ffmpeg `scdet` liefert je Bild einen Szenenwert; Todeskamera, Respawn und Menü sind harte Schnitte. Fast gleiche Bilder fallen weg, ein Bild je Schnitt bleibt.
- **Vielfalt.** Wo weder Ton noch Schnitt etwas zeigen: SigLIP-2-Einbettungen der Kandidaten und die Auswahl, die den größten Raum aufspannt (MaxInfo); das kostet auf der CPU Bruchteile einer Sekunde für gut hundert Bilder.
- **Zeitstempel bleiben.** Jedes Bild trägt weiter seine Sekunde als Text; das ist das Format, auf das Qwen trainiert ist. Ollama kann kein Video, llama.cpp seit Juni 2026 schon, mit echten Zeit-Tokens für Qwen 3.5. Das ist ein möglicher zweiter Backend, keine Voraussetzung.

## Stufe 6: Modell und Prompt

| Modell                   | Größe (Ollama) | Texterkennung (OCRBench) | Video (Video-MME) | Einordnung                                                                                  |
| ------------------------ | -------------- | ------------------------ | ----------------- | ------------------------------------------------------------------------------------------- |
| Qwen3-VL 8B Instruct     | 6,1 GB         | 896                      | 71,4              | bis 2026-09-24 Standard                                                                     |
| Qwen3.5 9B               | 6,6 GB         | 892                      | 78,4              | Standard seit 2026-09-24 (gemessen: 6/6 statt 5/6 Titel mit belegtem Ereignis, siehe unten) |
| Qwen3-VL 4B / Qwen3.5 4B | 3,3 / 3,4 GB   | 881 / 850                | 69,3 / 76,9       | für 6-GB-Karten                                                                             |
| Qwen3.5 27B, Qwen3.8 27B | 17 / 18 GB     | –                        | –                 | für 24-GB-Karten                                                                            |
| Gemma 4 E4B / 12B        | –              | keine Angabe             | –                 | höchstens 1120 Token je Bild: zu grob für HUD-Text                                          |
| Molmo 2 8B               | –              | keine Einzelwerte        | stark, 128 Bilder | interessant fürs Video, Ollama-Stand _unbestätigt_                                          |

Am Prompt ändern sich fünf Dinge, alle über Ollama möglich: kurz bleiben (längere Anweisungen senken die Trefferquote messbar); Temperatur 0 und JSON-Schema für die Sichtung; je Aussage die Bildnummern als Beleg verlangen; die Zusammenfassung zweimal ziehen und nur behalten, was in beiden steht; und für den Titel eine Prüfrunde, in der das Modell jede Behauptung gegen das genannte Bild prüft (Woodpecker). Die heutige Rückfrage bei mangelhaftem Titel bleibt.

## Stufe 7: Suche und Lernen aus Korrekturen

- **Einbettungen auf dem Server.** SigLIP 2 (Base oder so400m als ONNX) je Vorschaubild, gespeichert mit sqlite-vec in der bestehenden SQLite. Damit: ähnliche Clips, Suche nach Bildinhalt, die Referenzbank aus Stufe 1 und die Bildauswahl aus Stufe 5. Jina CLIP v2 fällt wegen Nicht-kommerziell-Lizenz aus.
- **Korrekturen als Beispiele.** Ändert jemand Titel oder Tags, wird das Paar aus Bild-Einbettung und Endfassung gespeichert. Bei der nächsten Analyse im selben Spiel kommen die drei ähnlichsten als Beispiele in den Prompt, nicht mehr, sonst leidet das kleine Modell. Tags sind das sauberere Signal, Titel tragen Stil. Prompt-Optimierer wie DSPy oder GEPA laufen nur bei uns, offline, um den ausgelieferten Standardprompt je Genre zu bauen; nicht auf dem PC der Nutzer.

## Datenschutz

- Alles läuft lokal; Netzwerk brauchen nur Modell-Downloads mit Prüfsumme und die Spiele-APIs, die es ohne nicht gibt (Valorant, PUBG, Halo, Destiny). Die sind je Spiel eine Option, aus, mit Hinweis, wohin welche Anmeldung geht.
- Valorant: Riot verlangt, jedes Produkt zu registrieren, auch bei inoffiziellen Schnittstellen, und verbietet Echtzeit-Overlays. Auswertung nach dem Spiel ist erlaubt. Vor dem Einbau registrieren, sonst weglassen.
- Vordergrundprozess: der Client merkt sich nur den Namen des Spiels je Aufnahme, kein Fensterprotokoll.
- Transkripte und Roh-Ereignisse bleiben im Trace auf dem PC; zum Server gehen Titel, Beschreibung, Tags, Zeitmarken.

## Messplan

Ohne Messsatz ist jede Prompt-Änderung Glaube. Zuerst der Satz, dann alles andere.

| Stufe       | Wie                                                                                                                   | Erfolg                                                                                                                                         | Verwerfen                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Messsatz    | 100 bis 300 Clips aus etwa zehn Spielen; je Clip Spiel, Ereignisse mit Sekunde, drei bis acht Tags, ein Satz Wahrheit | Läuft mit promptfoo gegen Ollama; Ereignis-Präzision und -Trefferquote bei ± 2 s, Tag-F1, Titeltreue als Fragen an ein größeres lokales Modell | –                                                                        |
| Spiel       | Alle Clips des Messsatzes ohne Ordnernamen                                                                            | Dateiname oder Prozess ≥ 0,98; Bildvergleich ≥ 0,9 bei ≥ 20 Referenzbildern                                                                    | Bildvergleich < 0,8: nur Dateiname und Prozess                           |
| OCR v6      | 200 Killfeed- und Banner-Ausschnitte, von Hand abgeschrieben                                                          | Zeichenfehler halbiert gegenüber v4; ≤ 50 ms je Ausschnitt auf der CPU                                                                         | Kein Gewinn: Ausschnitt- und Vergrößerungslogik ohne Modelltausch prüfen |
| HUD-Profil  | Ein Spiel (CS2 oder Valorant), 50 Clips mit Kills                                                                     | Wer wen ausschaltete ≥ 0,95 richtig; Duplikate ≤ 1 je Clip                                                                                     | < 0,85: Profil nur für Ergebnisbanner, Killfeed bleibt beim Modell       |
| Spieldaten  | Je Quelle 20 Clips mit Match                                                                                          | Zuordnung Clip zu Match ≥ 0,95; Kill-Sekunde ± 1 s                                                                                             | Zuordnung < 0,8: Quelle nur für Titel ohne Zeitmarken                    |
| Ton-Spitzen | 50 Clips mit Mikrofonspur, Moment von Hand markiert                                                                   | Spitze innerhalb ± 3 s des Moments in ≥ 0,7                                                                                                    | < 0,5: Schlussfenster bleibt, Ton nur als Zusatz                         |
| Bildauswahl | Messsatz, Raster gegen Bündel bei gleicher Bildzahl                                                                   | Mehr belegte Ereignisse, weniger verlorene Bilder, keine längere Laufzeit                                                                      | Laufzeit +20 % ohne Gewinn                                               |
| Modell      | Messsatz, Qwen3-VL 8B gegen Qwen3.5 9B (`think: false`)                                                               | Gleich viele gelesene Meldungen, bessere Beschreibung des Ablaufs                                                                              | Weniger gelesene Meldungen: bleibt Qwen3-VL                              |
| Beispiele   | 30 korrigierte Clips, Analyse mit und ohne drei Beispiele                                                             | Mehr Titel, die du so gelassen hättest; keine erfundenen Ereignisse                                                                            | Erfundenes aus Beispielen: nur Tags als Beispiele                        |

## Reihenfolge

1. Messsatz und Messlauf (Stufe „Messsatz“). Alles Weitere wird daran gemessen.
2. Spiel aus Dateiname und Vordergrundprozess (Stufe 1). Klein, sicher, hilft allen anderen Stufen.
3. Texterkennung auf PP-OCRv6 und Ausschnitte (Stufe 3, erste zwei Punkte). Größter Gewinn je Aufwand.
4. Ton-Spitzen für die Bildauswahl und Bündel um die Spitzen (Stufen 4 und 5).
5. Steam-Aufnahme, Rocket League, LoL, CS2 als exakte Quellen, in dieser Reihenfolge nach Aufwand.
6. HUD-Profile für zwei, drei Shooter, mit Beitragsanleitung.
7. Prompt-Änderungen und Modellvergleich (Stufe 6), erst jetzt, weil erst jetzt messbar.
8. Einbettungen, Suche, Beispiele aus Korrekturen (Stufe 7).

Nicht vorgesehen: das Bildmodell nachtrainieren, auf Ton oder Video in Ollama warten, Overwolf, TransNetV2 oder trainierte Bildauswahl (AKS, Frame-Voyager), Jina CLIP.

## Quellen

Modelle und Prompts

- Qwen3-VL Technical Report: https://arxiv.org/pdf/2511.21631v2
- Qwen3.5-9B, -4B: https://huggingface.co/Qwen/Qwen3.5-9B, https://huggingface.co/Qwen/Qwen3.5-4B
- Ollama-Bibliotheken: https://ollama.com/library/qwen3-vl, https://ollama.com/library/qwen3.5
- Gemma 4 Model Card (Token-Deckel je Bild): https://ai.google.dev/gemma/docs/core/model_card_4
- Molmo 2: https://allenai.org/blog/molmo2
- Ollama, kein Video: https://github.com/ollama/ollama/issues/18151; kein Ton: https://github.com/ollama/ollama/issues/11798; kein eigener Bildprojektor: https://github.com/ollama/ollama/issues/14575
- llama.cpp Video-Eingabe (Juni 2026): https://github.com/ggml-org/llama.cpp/discussions/20965
- Strukturierte Ausgabe in Ollama: https://docs.ollama.com/capabilities/structured-outputs
- CropVLM (Ausschnitte): https://arxiv.org/html/2511.19820v2
- Praxistest Gemma 4 auf Spielbildern: https://github.com/AntoninPrazsky/BS3D/issues/440
- VideoGameQA-Bench: https://arxiv.org/html/2505.15952v1
- NVIDIA, VLMs zur Annotation von Spielvideos (stehende HUD-Zustände): https://arxiv.org/html/2608.05949
- HAVEN, Halluzination in Video-Modellen (kurze Prompts): https://arxiv.org/html/2503.19622
- Woodpecker: https://arxiv.org/abs/2310.16045
- Fein-Tuning: https://unsloth.ai/docs/models/qwen3.5/fine-tune, https://github.com/modelscope/ms-swift

Texterkennung

- PP-OCRv6: https://arxiv.org/html/2606.13108v1, https://huggingface.co/blog/PaddlePaddle/pp-ocrv6
- PP-OCRv5 gegen v4: http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html
- ONNX-Modelle: https://huggingface.co/monkt/paddleocr-onnx; RapidOCR: https://github.com/RapidAI/RapidOCR
- crispy: https://github.com/Flowtter/crispy; valoscribe: https://github.com/JIYUN000000/valoscribe; Battlefield-Killfeed: https://github.com/luandev/batlefield_killefeed

Spieldaten

- Steam Timeline: https://partner.steamgames.com/doc/features/timeline; Ablage der Aufnahmen: https://steamcommunity.com/groups/SteamClientBeta/discussions/5/4630358592048904420; Leser: https://github.com/Nahassa/SteamRecordingYouTubeUploader, https://github.com/Cereal916/steam-recording-browser
- CS2: https://github.com/LaihoE/demoparser, https://github.com/Igor-Losev/deadem, https://github.com/claabs/cs-demo-downloader, Marker: https://github.com/valvesoftware/steam-for-linux/issues/12366
- Rocket League: https://github.com/nickbabcock/boxcars, https://github.com/nickbabcock/rrrocket
- Dota 2: https://github.com/dotabuff/manta
- LoL Live Client Data: https://github.com/XHXIAIEIN/LeagueCustomLobby/wiki/client:--game-client; Replay-API: https://developer.riotgames.com/replay-apis.html; ROFL ohne Statistik: https://github.com/RiotGames/developer-relations/issues/831
- Valorant: https://techchrism.github.io/valorant-api-docs/, https://valapidocs.techchrism.me/endpoint/match-details; Riot-Regeln: https://support-developer.riotgames.com/hc/en-us/articles/22698769097107-VALORANT
- PUBG-Telemetrie: https://documentation.pubg.com/en/telemetry-events.html
- Halo: https://github.com/acurtis166/SPNKr; Destiny: https://bungie-net.github.io/multi/operation_get_Destiny2-GetPostGameCarnageReport.html
- Fortnite-Referenzparser: https://github.com/Shiqan/FortniteReplayDecompressor/blob/master/CHANGELOG.md
- Hunt, nicht mehr lokal: https://github.com/Bzly/hunt-showdown-stat-recording; Tarkov: https://github.com/the-hideout/TarkovMonitor; Warframe: https://github.com/WFCD/warframe-deathlog
- Overwolf GEP: https://dev.overwolf.com/ow-electron/live-game-data-gep/live-game-data-gep-intro/; Medal: https://medal.tv/auto-clipping

Spiel erkennen

- NVIDIA-Dateinamen und `GeForce SHARE`-Marke: https://github.com/rebane2001/NvidiaInstantRename
- Game-Bar-Namen: https://learn.microsoft.com/en-us/answers/questions/4299624/game-bar-captures-file-naming-conventions
- OBS-Dateinamen: https://obsproject.com/forum/threads/ability-to-change-replay-buffer-output-path-based-on-the-name-of-a-program-or-game.145438/
- get-windows: https://github.com/sindresorhus/get-windows; Steam-Manifeste: https://github.com/mattb-prg/steam-acf-parser; Epic-Manifeste: https://jayd.ml/games/2020/05/16/epic-games-store-steam-libraries.html

Ton, Bildauswahl, Suche, Messung

- Ton als stärkstes Signal: https://arxiv.org/html/2609.17923, https://www.sciencedirect.com/science/article/pii/S2666827022000469
- Gameplay Highlights Generation (X-CLIP je Sekunde): https://arxiv.org/html/2505.07721
- Parakeet-TDT-0.6B-v3: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3; Qwen3-ASR: https://github.com/QwenLM/Qwen3-ASR; sherpa-onnx in Node: https://deepwiki.com/k2-fsa/sherpa-onnx/3.9-node.js-bindings-(addon-api-and-wasm)
- CLAP in Transformers.js: https://huggingface.co/Xenova/clap-htsat-unfused; BattleSound: https://www.mdpi.com/1424-8220/23/2/770/htm; dejavu: https://github.com/worldveil/dejavu
- ffmpeg scdet: https://ffmpeg.org/ffmpeg-filters.html; PySceneDetect: https://www.scenedetect.com/features/
- Bildauswahl: F2C https://arxiv.org/html/2510.02262v2/, MaxInfo https://arxiv.org/html/2502.03183v3, BOLT https://arxiv.org/html/2503.21483v1
- SigLIP 2: https://huggingface.co/blog/siglip2, ONNX: https://huggingface.co/onnx-community/siglip2-large-patch16-512-ONNX; sqlite-vec: https://alexgarcia.xyz/sqlite-vec/js.html; Jina CLIP v2 (Lizenz): https://huggingface.co/jinaai/jina-clip-v2
- Messung: promptfoo mit Ollama https://www.promptfoo.dev/docs/providers/ollama/; VDCscore https://arxiv.org/abs/2410.03051; GEPA https://github.com/gepa-ai/gepa
- Datensätze: VideoGameBunny https://huggingface.co/datasets/VideoGameBunny/Dataset, GamePhysics https://huggingface.co/datasets/asgaardlab/GamePhysics-FullResolution

## Erste Messung (2026-09-24)

Zwölf Clips mit Handprüfung (Stichprobe `pruefung-2`: Valorant, Fortnite, Rainbow Six, Call of Duty, Chained Together, ARC Raiders, Desktop). Gleiche Einstellungen je Lauf: Spielernamen, ganzer Clip mit einem Bild alle drei Sekunden, Texterkennung, Fortnite-Replays.

| Lauf                                        | Titel nennt belegtes Ereignis | Erfundenes im Titel | Laufzeit je Clip |
| ------------------------------------------- | ----------------------------- | ------------------- | ---------------- |
| Qwen3-VL 8B, PP-OCRv4, ohne Ton             | 4/6                           | 0                   | 77 s             |
| Qwen3-VL 8B, PP-OCRv5-Lesen, mit Transkript | 5/6                           | 0                   | 77 s             |
| Qwen3.5 9B, PP-OCRv5-Lesen, mit Transkript  | 6/6                           | 1 (Karte „Dantzig“) | 76 s             |

Die erfundene Karte fängt seither die Titelprüfung ab (`agent/wording.ts`: „auf“ plus Eigenname muss bei R6 die erkannte Karte sein). PP-OCRv5 für lateinische Schrift las an 75 Killfeed-Ausschnitten mit bekannter Wahrheit 62 Opfernamen exakt, PP-OCRv4 53, bei gleicher Rechenzeit (`.docs/tools/ocr-vergleich.mts`). Zwölf Clips sind für eine Entscheidung knapp; der Messsatz aus der Reihenfolge oben bleibt nötig.

## Voice-Chat im Titel (2026-09-25)

Parakeet TDT 0.6B v3 (sherpa-onnx, CPU) schreibt einen Clip von zwei Minuten in rund 4 bis 8 Sekunden mit, Whisper medium brauchte 91 Sekunden. Das Transkript allein reichte nicht: In der Zusammenfassung mit Bild beschrieb das Modell meist das Bild, auch wenn der Clip von einem Gespräch lebt. Ein Fortnite-Clip, in dem zwei Spieler rätseln, ob eine Figur Obi-Wan Kenobi oder Yoda ist, hieß in drei Läufen „Obi-Wan oder Yoda?“, „Spitzhacke vor Eiswand“ und „Eiswand-Abenteuer“.

Seitdem fragt die Pipeline bei Clips ohne belegtes Ereignis zuerst nur mit dem Text, worum es im Gespräch geht (`LocalAnalyzer.topic`), und gibt das Thema der Titelregel vor. Ein einzelnes Wort oder ein wörtlich zitierter Satz zählt nicht als Thema (`usableTopic`). Ergebnis in derselben Stichprobe `pruefung-2`:

| Clip                               | ohne Ton                       | Transkript, ohne Themenfrage | mit Themenfrage                     |
| ---------------------------------- | ------------------------------ | ---------------------------- | ----------------------------------- |
| Fortnite, Star-Wars-Rätsel (3 + 2) | —                              | 1 von 3 zum Gespräch         | 5 von 5 „Wer ist Obi-Wan Kenobi?“   |
| ARC Raiders, Fehlschuss aus Panik  | Duckt hinter Säule             | Versteckt hinter der Säule   | Entschuldigung für den Falschschuss |
| Gespräch über Ausbildung           | Deck-Ansicht im Fortnite-Thema | Kampfmenü im Fortnite-Modus  | Was ist vernünftig?                 |
| Desktop, Figur ohne Kopf           | Interaktion am pinken Auto     | Kopflöser am pinken Auto     | Kopfloser Charakter                 |
| Chained Together, Chaos am Seil    | Hängt an Kette                 | Hängen an der Kette          | Zuruf an einen Mitspieler           |

Die sechs Clips mit belegtem Ereignis blieben unverändert (6/6 nennen das Ereignis, nichts erfunden); die Themenfrage läuft bei ihnen nicht. Der Chained-Together-Titel ist eine Spielabsprache statt der Pointe („nie wieder in die Mitte“); er ist nicht falsch, aber schwächer. Lachen erkennt Parakeet nicht: es schreibt bei Lachflashs keine Wiederholungen wie Whisper, deshalb entstehen mit ihm keine Lachmarken.

## Größerer Prüfsatz (2026-09-25)

34 handgeprüfte Clips aus 13 Spielen (Stichproben `pruefung` und `neutest`), die nicht zum Entwickeln dienten. Verglichen mit dem Stand vom 23.09. (Qwen3-VL 8B, 24 Bilder aus dem Schlussfenster, ohne Texterkennung und Ton) auf denselben Clips:

| Stand                                                                                        | Tags richtig | Titel nennt belegtes Ereignis | Falsches im Titel | Laufzeit je Clip |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------- | ----------------- | ---------------- |
| 23.09.                                                                                       | 24/26        | 12/16                         | 0                 | 51 s             |
| 25.09.: Qwen3.5 9B, ganzer Clip alle 3 s, Texterkennung, Replays, Voice-Chat, Titelprüfungen | 41/41        | 16/16                         | 0                 | 67 s             |

Neu gefunden werden vor allem Kills und Kopfschüsse aus dem Valorant-Killfeed sowie Karte und Rundenausgang in R6: Die Titel lauten jetzt etwa „Runde gewonnen auf Border“, „Ausgeschaltet von … auf Fortress“ oder „Drei Kopfschüsse zum Sieg“. Fünf Abweichungen zwischen Pipeline und Handprüfung lagen an der Handprüfung: Standbilder des Killfeeds zeigten die Kopfschüsse und zweiten Kills, die die Pipeline gemeldet hatte. Die Wahrheit wurde mit Beleg korrigiert, nicht an die Pipeline angepasst.

Dabei behoben:

- **R6-Texterkennung mit PP-OCRv5.** Das Lesemodell schreibt Banner ohne Leerzeichen („NIGHTHAVENLABS“, „WONROUND2“); weder Karte noch Rundenausgang wurden erkannt. An 12 R6-Clips jetzt 8 Karten und 6 Rundenausgänge, jeder Ausgang am Standbild bestätigt, statt 5 Karten (eine falsch: „Tower“ ist auf Skyscraper ein Raum) und keinem Ausgang.
- **Ordner „R6siege“** älterer Aufnahmen galt nicht als Rainbow Six, die Texterkennung lief für 61 Clips nicht.
- **Kurze Clips.** Bei Clips bis 30 Sekunden zählt der ganze Clip als Moment; ein Kill nach 1,3 von 12 Sekunden fehlte sonst im Titel.
- **Messwerkzeug.** Spracherkennung und Texterkennung bringen je eine eigene ONNX Runtime mit; im selben Prozess scheitert die zweite (Fehler 182). Im Client laufen sie getrennt, jetzt auch im Messwerkzeug.

Grenzen: Es gibt nur fünf Valorant-Clips, alle schon in den Stichproben. Keiner der 268 Clips hat eine eigene Mikrofonspur; Ereignisse aus dem Spielton lohnen sich erst mit „Mikrofon als separate Spur“ in der NVIDIA App.
