# Konzept: Ton für Spaßclips

**Ziel.** Titel für Spaßclips aus dem, was gesagt oder gelacht wird, etwa „Lachkrampf nach dem Fallschaden“ oder ein kurzes Zitat. Das geht in zwei Stufen. Zuerst findet ein kleines Modell auf der CPU Lacher und Rufe in der ganzen Mikrofonspur. Danach transkribiert Whisper nur diese Stellen. Noch landet kein Modell im Installer; alles wird bei Bedarf geladen.

Dieses Konzept stützt sich auf eine Recherche vom 2026-09-24 mit 63 Quellen. Gemessen ist davon nichts; welche Zahlen vorher feststehen müssen, steht unten im Messplan.

## Was schon da ist

- `ffprobe` listet alle Tonspuren. Die Mikrofonspur wird erkannt: zuerst am Titel, dann an den Pegeln (stumme Spuren fallen weg), dann an der Reihenfolge (Spielton zuerst, Mikrofon danach). Drei unabhängige Skripte im Netz nehmen dieselbe Reihenfolge an; eine echte NVIDIA-App-Datei hat sie hier noch nicht bestätigt.
- Eine Spur lässt sich als WAV mit 16 kHz mono herauslösen, dem Eingangsformat von YAMNet und Whisper.
- `npm run audio -- "<Ordner>" --out "<WAV-Ordner>"` zeigt Spuren und Pegel und schreibt jede Spur zum Anhören heraus.
- Die Wiedergabekopie mischt alle Spuren, weitere Spuren mittig gefaltet. Sonst fehlte die Stimme im Browser, oder sie käme nur auf einem Ohr an.

## Stufe 1: Lacher und Rufe finden

**Modell: YAMNet** (Google, Apache-2.0). Es erkennt 521 Klassen aus AudioSet.

- **Laufzeit:** ONNX Runtime auf der CPU. Sie ist mit der R6-Texterkennung schon im Client, eine neue Laufzeit braucht es also nicht.
- **Modell:** Die Community-Fassung per tf2onnx ist 16 MB groß, nimmt direkt die Wellenform und hat das Mel-Frontend im Graph. Sie wird bei Bedarf geladen, gepinnt auf Hugging-Face-Revision und SHA-256.

**Klassen**

| Zweck        | Indizes                                 | Hinweis                                                                                                   |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lachen       | 13–18 (Laughter und fünf Untertypen)    | Als Familie zusammenfassen; Untertypen wie Giggle, Snicker, Chuckle taugen nicht für Titel (AP 0,17–0,26) |
| Rufen, Jubel | 6–11 (Shout bis Screaming), 61 Cheering | Als „Aufregung“                                                                                           |
| Kontext      | 0 Speech                                | Plausibilität der Mikrofonspur: viel Sprache, wenig Spielsound                                            |

**Ablauf**

1. Die Mikrofonspur als 16 kHz mono dekodieren. Sitzt das Mikrofon nur auf einem Kanal, wird dieser genommen, statt beide zu mitteln; Mitteln kostet 6 dB.
2. YAMNet über Fenster von 0,96 s mit 0,48 s Schritt laufen lassen. Lachwert je Fenster ist der höchste Wert der Klassen 13–18.
3. Glätten: Ein Lacher gilt ab zwei von drei aufeinanderfolgenden Fenstern über der Schwelle. Die Schwelle wird an eigenen Clips kalibriert, Startwert 0,3.
4. Ergebnis: Ereignisse `laugh` und `shout` mit Beginn, Dauer und Stärke.

**Systemspur.** Stimmen und Lachen der Mitspieler aus Discord stehen, wenn überhaupt, nur in der Systemspur, gemischt mit Spielsound. Das gilt nur, wenn Discord über das Standardgerät läuft. Stufe 1 läuft dort getrennt und mit höherer Schwelle; ob sie brauchbar ist, klärt erst die Messung.

**Kosten.** YAMNet braucht etwa 69 Mio. Multiplikationen je Fenster. Hochgerechnet aus einer TensorFlow-Messung liegt eine Minute Audio unter 2 s CPU; mit ONNX Runtime auf einem Desktop-Prozessor vermutlich deutlich weniger. Das ist nicht gemessen.

**Alternative: CED-tiny** (Apache-2.0, 6,7 MB, AudioSet-mAP 48,1 statt 30,6). Es ist ein Clip-Tagger, die Zeitauflösung entsteht erst über eigene Fenster. Es kommt nur in Frage, wenn YAMNet an der Messung scheitert.

## Stufe 2: Nur an den Fundstellen transkribieren

**Ausschnitte**

- Je Lacher 6 s davor bis 1 s danach, denn meist fällt kurz vor dem Lachen das, worüber gelacht wird.
- Je Ruf 3 s davor bis 3 s danach.
- Überlappende Ausschnitte werden zusammengefasst, höchstens drei je Clip.

**Laufzeit und Modell**

- whisper.cpp (MIT) über `@fugood/whisper.node`: MIT, vorgebaut, Windows-CPU-Addon 2,8 MB ohne VC++-Runtime. Es läuft in einem eigenen Prozess, damit der Client flüssig bleibt. Rückfalllösung ist `whisper-cli.exe` als Kindprozess.
- Die GPU bleibt frei; sie gehört Ollama.
- Standardmodell `ggml-small-q8_0` mit 252 MiB. Laut Whisper-Paper liegt die Wortfehlerrate auf Deutsch (FLEURS) bei 10,2 %.
- Qualitätsstufe `ggml-large-v3-turbo-q5_0` mit 547 MiB, etwa auf dem Niveau von large-v2 mit 4,5 %.
- Beide Modelle werden bei Bedarf geladen, per SHA-256 geprüft und im Cache des Clients abgelegt.

**Schutz vor Erfundenem**

- Vor Whisper läuft eine Sprachaktivitätserkennung (Silero VAD, 0,9 MB, MIT). Reines Lachen ohne Worte ist genau der Fall, in dem Whisper sonst Text erfindet.
- Danach filtert eine Sperrliste bekannte Halluzinationen, etwa „Untertitel der Amara.org-Community“, „Untertitel im Auftrag des ZDF“ oder „Copyright WDR“.
- Dazu kommt eine Schwelle für „keine Sprache“.

**Kosten.** Whisper rechnet immer ein 30-s-Fenster, ein kurzer Ausschnitt kostet also so viel wie ein langer. Hochgerechnet sind das je Ausschnitt 2–5 s CPU mit small und 10–30 s mit turbo. Auch das ist nicht gemessen.

## Einbau in die Analyse

- **Tatsachen im Prompt,** zum Beispiel „Sekunde 42,1: Du lachst (Mikrofon).“ und „Gesagt kurz davor: „…““.
- **Titel:** Lachen und Rufe darf ein Titel nennen, wenn sie belegt sind. Ein Zitat im Titel muss sich im Transkript wiederfinden, sonst gibt es eine Rückfrage. Das ist dieselbe Prüfung wie bei Kills.
- **Tags** wie „Lachen“ kommen erst nach der Messung, weil sie das Tag-Vokabular ändern.
- **Ohne eigene Mikrofonspur** laufen beide Stufen nicht: In der gemischten Spur überdeckt der Spielsound die Stimme.
- **Option:** Wie bei Fortnite und R6 wird das eine Option, die zunächst aus ist.

## Datenschutz

- Alles läuft lokal. Netzwerk braucht nur der einmalige Download der Modelle, mit Prüfsumme.
- Transkripte erreichen deinen Server nur als Titel, Beschreibung und Zeitmarken. Der Rohtext bleibt im Trace auf dem PC.
- ONNX Runtime von Microsoft enthält in den Windows-Builds Telemetrie-Ereignisse (ETW). Laut Datenschutzhinweis des Projekts werden sie nur aufgezeichnet, wenn eine Trace-Sitzung läuft, und nur mit deiner Zustimmung zu den Windows-Diagnosedaten übertragen. Einen Schalter in Node gibt es nicht. Die WASM-Fassung hätte keine Telemetrie, wäre aber für die Texterkennung zu langsam.

## Messplan

| Stufe      | Wie                                                             | Erfolg                                                                             | Verwerfen                                                                                                 |
| ---------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Spuren     | Echte Aufnahme: 10 s nur ins Mikrofon sprechen, `npm run audio` | Reihenfolge, Kanäle und Duplikate bekannt; Mikrofonspur erkannt                    | Spur falsch erkannt: feste Spurnummer als Einstellung                                                     |
| Lacher     | 30 Clips mit Mikrofonspur, Lacher von Hand markiert             | Präzision ≥ 0,9 bei Trefferquote ≥ 0,6 („Clip hat Lacher im Schluss“), Zeit ± 1 s  | Präzision < 0,8, etwa durch Spielsound im Headset: höhere Schwelle, CED-tiny testen oder Stufe 1 aufgeben |
| Kosten 1   | Rechenzeit je Minute Mikrofonspur                               | < 5 s CPU                                                                          | Spürbares Ruckeln beim Spielen                                                                            |
| Transkript | 20 Lacher-Ausschnitte, von Hand geprüft                         | Das verständliche Schlüsselwort steht im Transkript in ≥ 70 %; keine Halluzination | Erfundener Text trotz VAD und Sperrliste: Zitate nur in die Beschreibung, nie in den Titel                |
| Kosten 2   | Zeit je Ausschnitt, small gegen turbo                           | small ≤ 5 s; turbo nur, wenn deutlich besser                                       | small > 15 s: nur noch ein Ausschnitt je Clip                                                             |
| Titel      | Spaßclips mit und ohne Ton-Stufen, von dir bewertet             | Mehr Titel, die treffen, woran du dich erinnerst; kein Widerspruch zum Transkript  | Kein Gewinn gegenüber Titeln ohne Ton: Option bleibt aus                                                  |

## Nächste Schritte, wenn du sie freigibst

1. Eine echte NVIDIA-App-Aufnahme mit getrennter Mikrofonspur prüfen (`npm run audio`).
2. Ein Messwerkzeug `npm run laughs` bauen: YAMNet laden, Lacher je Clip listen, ohne Einbau in die Analyse.
3. Die Schwelle kalibrieren, dann Whisper als zweites Messwerkzeug.
4. Erst nach bestandener Messung einbauen, hinter einer Option.
