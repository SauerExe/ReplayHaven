# Messplan für Änderungen an der Analyse

Jede Änderung an der Analyse gilt erst als Verbesserung, wenn sie an echten Clips gemessen ist. Hier steht vorab, was je Änderung gemessen wird, was als Erfolg zählt und wann sie verworfen wird. Messprotokolle und Wahrheitsdaten bleiben lokal.

## Spielernamen je Spiel

**Was sich ändert.** Der Client speichert eine Namensliste; jeder Name gilt für ein Spiel oder für alle. Die Analyse nennt der KI nur die Namen zum Spiel des Clips. Ereignisse, Tags und Titelprüfung hängen nicht von Namen ab. Mit genau einem passenden Namen bleibt der Prompt wortgleich wie bisher. Neu ist nur, dass im jeweiligen Spiel der richtige Name steht, wo früher ein fremder oder gar keiner stand. Welche Namen genannt wurden, steht im Trace unter `playerNames`.

**Messung.** Nimm eine Stichprobe aus mindestens zwei Spielen mit Killfeed-Szenen, etwa aus den 41 geprüften Clips.

- Lauf A: ein Name für alle Spiele, wie bisher.
- Lauf B: die Liste je Spiel.

Zu vergleichen sind Beschreibungen, Titel und Tags.

**Erfolg.**

- In den Spielen, die in Lauf A einen falschen oder keinen Namen bekamen, gibt es weniger Beschreibungen mit falscher Richtung (Kill als Tod, fremder Kill als deiner).
- Die Tags bleiben identisch. Jede Abweichung wäre ein Fehler, weil Namen keine Ereignisse erzeugen.
- Titel mit belegtem Ereignis nennen es mindestens so oft wie bisher (14 von 17).

**Verwerfen**, wenn eines davon eintritt:

- Lauf B hat mehr Richtungsfehler oder Personenverwechslungen.
- Titel oder Beschreibungen nennen deinen Namen in der dritten Person („SpielerEins gewinnt“).

Dann fliegt der Satz mit mehreren Namen aus dem Prompt. Die gespeicherte Liste bleibt.

## Fortnite-Ereignisse aus Replays

**Was sich ändert.** Mit **Fortnite-Replays einbeziehen** (Standard: aus) liest der Client das Replay des Matches.

- Kills, Knocks, eigenes Ausscheiden, Serien (Kills mit höchstens 12 s Abstand) und Sieg kommen dann aus dem Replay. Waffenart und Entfernung kommen mit.
- Gelesene Kills und Tode sowie NVIDIA-Ereignisse aus dem Dateinamen ersetzt das Replay. Runden- und Matchmeldungen vom Bildschirm bleiben.
- Titel, die Serie, Waffe oder Entfernung falsch nennen oder das Besondere (Serie, Snipe, Fernschuss) weglassen, bekommen eine Rückfrage. Diese strengere Prüfung greift nur bei Clips mit Replay-Ereignissen; ohne Replay prüft die Analyse wie bisher.
- Clips aus einem laufenden Match warten bis zu dessen Ende, höchstens 45 Minuten.

**Werkzeug.** `npm run fortnite -- --clips "<NVIDIA-Ordner>" --json fortnite.json` braucht weder KI noch Upload und zeigt:

- je Replay das erkannte Konto samt Begründung,
- je Fortnite-Clip die Zeitdeutung (`name-end`: Dateiname = Speichern, `name-start`: Dateiname = Aufnahmebeginn),
- die Ereignisse mit Clipsekunde und den Titel, der ohne KI daraus würde.

Mit `--account <Epic-Konto-ID>` gilt die eingetragene ID statt der Automatik.

| Prüfung       | Wie                                                                                                                                        | Erfolg                                                                                 | Verwerfen                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Konto         | Erkannte ID je Replay gegen die eigene Konto-ID (epicgames.com, Kontoeinstellungen)                                                        | Kein falsches Konto; höchstens 20 % „nicht eindeutig“                                  | Schon ein falsches Konto: Die Automatik wird nicht genutzt, nur die eingetragene ID                                                                    |
| Zeit          | Clips mit sichtbarer „ELIMINIERT: …“-Meldung oder NVIDIA-Ereignis im Namen: Replay-Sekunde gegen die Sekunde, in der die Meldung erscheint | Abweichung ≤ 2 s in ≥ 90 % der Clips; Zeitdeutung offen bei ≤ 20 % der Clips           | Systematischer Versatz über 3 s oder mehr als 20 % offen: Die Zeitabbildung wird überarbeitet, das Replay nicht genutzt                                |
| Zählung       | Eigene Kills und Knocks im Clip von Hand gezählt                                                                                           | Exakt in ≥ 90 % der Clips; kein Clip mit Kill, in dem keiner ist                       | Ein erfundener Kill (fremdes Konto oder falsche Zeit)                                                                                                  |
| Waffe         | Waffenart je Kill per Sichtprüfung                                                                                                         | ≥ 90 % richtig                                                                         | Unter 80 %: Fortnite hat die Codierung der Todesursachen verschoben; die Waffe fliegt aus Titeln, bis die Tabelle in `agent/fortnite.ts` angepasst ist |
| Entfernung    | Fünf Fernkills oder Snipes: Entfernung plausibel zum Bild                                                                                  | Alle in der richtigen Größenordnung                                                    | Grob daneben: Die Entfernung fliegt aus Titeln                                                                                                         |
| Titel (KI)    | Fortnite-Clips mit Option an gegen aus                                                                                                     | Titel mit Replay-Ereignis nennen es in ≥ 15 von 17; Besonderheit wo vorhanden          | Ein Titel widerspricht den Replay-Fakten, oder die Titel werden schlechter als ohne Replay: Die Option bleibt aus                                      |
| Tags          | Kill, Multikill, Tod, Sieg aus dem Replay gegen die Wahrheit                                                                               | Mindestens so gut wie aus Meldungen (29 von 31)                                        | Schlechter als aus Meldungen                                                                                                                           |
| Warteschlange | Während eines Matches gespeicherte Clips                                                                                                   | Nach dem Match analysiert und hochgeladen, keiner länger als 45 Minuten zurückgehalten | Ein Clip bleibt dauerhaft ausstehend                                                                                                                   |

**Offene Annahmen**, die die Messung klärt:

- Die Codierung der Todesursachen ist an Replays bis Version 32.00 (2024) geprüft; neuere Saisons können sie verschoben haben.
- Wo in NVIDIA-Namen das Speichern steht und wo der Aufnahmebeginn, entscheidet der Änderungszeitpunkt der Datei, bei Clips unter etwa 17 Sekunden bleibt das offen.
- In Teammatches kann die Match-Statistik erst beim Ausscheiden des letzten Teammitglieds entstehen; dann trägt dieser Hinweis nicht.
- Fortnite schreibt das Replay eines laufenden Matches fortlaufend, sodass seine Änderungszeit steigt. Nur dann wartet ein Clip auf das Matchende. Sonst wird er sofort ohne Replay analysiert; das zeigt die Zeile „Warteschlange“.

## Tonspuren und Mikrofon

**Was sich ändert.**

- `ffprobe` liefert alle Tonspuren einer Aufnahme.
- Die Mikrofonspur wird erkannt: zuerst am Titel, dann an den Pegeln (stumme Spuren zählen nicht), dann an der Reihenfolge (Spielton zuerst, Mikrofon danach). Bleibt es offen, gibt es keine Mikrofonspur statt einer geratenen.
- Eine Spur lässt sich als WAV mit 16 kHz mono herauslösen.
- Die Analyse nutzt den Ton noch nicht.
- Auf dem Server bekommen Aufnahmen mit mehreren Tonspuren eine Wiedergabekopie mit gemischtem Ton. Das Bild wird dabei kopiert, nicht neu kodiert.

**Messung.** Schalte in der NVIDIA App „Mikrofon als separate Spur“ ein und nimm zehn Clips aus verschiedenen Spielen auf, in denen du sprichst. Dann `npm run audio -- "<Ordner>" --out "<WAV-Ordner>"` und die Spuren anhören; dazu die Clips im Archiv abspielen.

**Erfolg.**

- Die Mikrofonspur ist in allen zehn Clips richtig erkannt oder bleibt offen, nie falsch.
- Im Archiv sind Spielton und Stimme zu hören, ohne hörbares Übersteuern.
- Clips mit nur einer Spur bleiben unverändert: Sie bekommen keine Wiedergabekopie.

**Verwerfen**, wenn eines davon eintritt:

- Eine Spur ist falsch als Mikrofon erkannt: Die Reihenfolge-Regel fällt weg, die Spurnummer wird als Einstellung wählbar.
- Die Wiedergabe verzerrt: Mischpegel und Begrenzer werden angepasst.

## R6: Karte und Rundenausgang per Texterkennung

**Was sich ändert.** Mit **R6: Karte und Rundenausgang per Texterkennung** (Standard: aus) liest der Client jeden R6-Clip mit PaddleOCR PP-OCRv4 über ONNX Runtime auf der CPU. Er nimmt zwei Bilder je Sekunde in 1280 Pixeln Breite, wie im Blindtest.

- Karte: Der Kartenname muss eine ganze gelesene Zeile sein oder vorne vor Ort und Land stehen („OREGON, USA“), mit Sicherheit ≥ 0,85, in mindestens zwei Bildern. Bei Gleichstand zweier Karten gilt keine.
- Rundenausgang: Die gelesenen Zeilen laufen durch dasselbe Lexikon wie die Meldungen des Modells, genommen werden nur Runden- und Matchergebnisse. Ein Ergebnis des Modells an derselben Stelle (±5 s) weicht dem der Texterkennung.
- Titel: Die Karte steht als Tatsache im Prompt. Nennt ein Titel eine andere oder eine nicht erkannte R6-Karte, gibt es eine Rückfrage; der Ersatztitel hängt „auf <Karte>“ an. Ohne die Option bleibt die Titelprüfung wie bisher.

**Werkzeug.** `npm run r6 -- "<R6-Ordner>" --json r6.json` braucht weder KI noch Upload und zeigt je Clip Karte, Ergebnisse und Rechenzeit. Mit `--rows` schreibt es alle gelesenen Zeilen je Bild in die JSON-Datei, um Fehlgriffe nachzuvollziehen.

| Prüfung       | Wie                                                    | Erfolg                                                     | Verwerfen                                                                                   |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Karte         | Erkannte Karte gegen die Wahrheit, mindestens 26 Clips | Nie falsch; offen ist erlaubt                              | Eine falsche Karte: Die Regel wird strenger (etwa drei Bilder oder feste Bildregion)        |
| Abdeckung     | Anteil der Clips mit erkannter Karte                   | Wird gemessen und berichtet, keine Schwelle                | —                                                                                           |
| Rundenausgang | Ergebnisse gegen die Wahrheit                          | Nie falsch; mindestens so viele gefunden wie vom Modell    | Ein falsches Ergebnis: Die Texterkennung liefert keine Rundenergebnisse mehr, nur die Karte |
| Tags          | Rundensieg, Runde verloren, Sieg, Niederlage           | Mindestens so gut wie bisher (29 von 31 über alle Tags)    | Schlechter als ohne Texterkennung                                                           |
| Titel (KI)    | R6-Clips mit Option an gegen aus                       | Karte im Titel nur, wenn erkannt; nie eine falsche         | Ein Titel mit falscher Karte                                                                |
| Kosten        | Rechenzeit laut Trace (`texts.seconds`) je Clip        | Unter 90 s für einen 2-Minuten-Clip, kein Ruckeln im Spiel | Spürbares Ruckeln beim Spielen: weniger Kerne oder nur das Schlussfenster lesen             |
