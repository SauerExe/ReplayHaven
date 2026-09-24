# Recherche: R6-Match-Replays als Ereignisquelle

**Ziel.** Genaue R6-Ereignisse für Titel wie „Ace auf Oregon“ oder „Doppel-Kill per Kopfschuss“. Den dichten Killfeed per Texterkennung zu lesen ist gescheitert. Die Quelle wären hier die Match-Replay-Dateien, die das Spiel selbst schreibt.

Stand: Recherche vom 2026-09-24. Gemessen ist nichts; eine aktuelle `.rec`-Datei lag hier nicht vor. Nichts davon ist eingebaut.

## Was das Spiel schreibt

- **Ordner:** Im Installationsordner des Spiels unter `MatchReplay`, laut Ubisoft etwa `…\Ubisoft Game Launcher\games\Tom Clancy's Rainbow Six Siege\MatchReplay`.
- **Dateien:** Je Match ein Ordner `Match-JJJJ-MM-TT_hh-mm-ss-<n>`, darin eine Datei je Runde: `…-R01.rec`, `…-R02.rec` usw.
- **Aufbewahrung:** Das Spiel behält nur die jüngsten 10 bis 12 Matches; die Quellen nennen beide Zahlen. Die Auswertung muss also bald nach dem Match laufen, so wie der Watcher ohnehin arbeitet.
- **Voraussetzung:** Match Replay muss in den Spieleinstellungen eingeschaltet sein. Welche Spielmodi aufgezeichnet werden, klärt der erste Messschritt.
- **Format:** zstd-komprimiert in Blöcken. Am Anfang steht ein Kopf mit Klartext-Eigenschaften, danach folgen Datenpakete ohne Dokumentation.

## Was sich daraus lesen lässt

Grundlage ist der Parser r6-dissect (MIT, Go).

| Angabe                                          | Quelle          | Hinweis                                                                 |
| ----------------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| Karte, Spielmodus, Match-Art, Rundennummer      | Kopf            | Exakt                                                                   |
| Aufnehmender Spieler                            | Kopf            | Exakt über `recordingplayerid`; keine Heuristik wie bei Fortnite        |
| Punktestand, Sieger, Siegbedingung, Rolle       | Kopf und Pakete | Siegbedingung etwa „Gegner ausgeschaltet“, „Defuser entschärft“, „Zeit“ |
| Kills mit Schütze, Opfer, Kopfschuss, Rundenuhr | Pakete (Muster) | Auch DBNO und Finish-off; Teamkills filtert der Parser heraus           |
| Defuser gelegt oder entschärft, Operatoren      | Pakete und Kopf |                                                                         |
| Waffe                                           | nicht enthalten | Titel mit Waffe bleiben bei R6 also aus                                 |

**Daraus ableitbar:**

- Kills des eigenen Spielers je Runde, daraus Serien und das Ace (fünf Kills in einer Runde).
- Kopfschüsse.
- Rundensieg oder -niederlage mit Siegbedingung.
- Clutch, wenn der eigene Spieler als Letzter seines Teams übrig ist und das Team gewinnt.

Namen anderer Spieler gehören nicht in Titel.

## Welcher Parser

- **Original, redraskal/r6-dissect:** Die letzte Änderung ist vom 2025-09-15. Es liest nur bis Y10S3.
- **Fork, Gipson62/r6-dissect:** Er wird gepflegt; die letzte Änderung vom 2026-08-21 ergänzt Y11S2. Seine Versionsprüfungen lauten „ab Y10S4“, neuere Seasons nehmen also den neuesten Pfad. Ob Y11S3 damit richtig gelesen wird, ist offen. Der Fork hat keine Releases.
- **Gelesen wird über Byte-Muster** mit Versionsschwellen, nicht über ein dokumentiertes Format. Nach einem Season-Update können Kills fehlen oder falsch zugeordnet werden, bis der Parser nachzieht.

## Zeit: von der Rundenuhr zur Clipsekunde

Kill-Zeiten sind die Rundenuhr aus dem HUD, keine Uhrzeit. Im Beispiel von r6-dissect fällt das Aufdecken des Ziels in die Vorbereitung (0:26). „Friendly Fire is now active“ steht bei 2:59, also am Anfang der Aktionsphase, die von 3:00 herunterzählt. Die Kills folgen darunter. Nach dem Legen des Defusers zeigt das HUD den Defuser-Countdown. Wie der Parser die Zeit danach führt, ist ohne echte Datei nicht geklärt.

Eine Uhrzeit steht nur im Kopf (`datetime`) und in der Dateizeit. Der Kopf ist vermutlich UTC; r6-dissect rechnet ihn zur Anzeige in Ortszeit um. Das grenzt die Runde ein, reicht aber nicht für Kills auf die Sekunde: Wie viel Zeit zwischen Kopfzeit und 3:00 liegt (Operatorwahl, Vorbereitung), ist unbekannt.

**Vorschlag**

1. **Runde wählen über die Uhrzeit.** Das Clipfenster kommt wie bei Fortnite aus NVIDIA-Namen und Dateizeit. Das Rundenfenster reicht von der Kopfzeit bis zur letzten Schreibzeit der Datei. Ob der Kopf UTC oder Ortszeit ist, entscheidet wie bei Fortnite die Dateizeit.
2. **Sekunde bestimmen über die Rundenuhr im Bild.** Die vorhandene Texterkennung liest dafür nur den kleinen Ausschnitt oben in der Mitte, etwa ein Bild je Sekunde. Liest sie bei Clipsekunde 12 „1:51“, gilt für jeden Kill der Runde: Clipsekunde = 12 + (111 − Kill-Sekunden). Mehrere Anker müssen übereinstimmen (Clipsekunde + Uhr bleibt innerhalb einer Phase gleich), Ausreißer fallen weg.
3. **Ohne lesbare Uhr** gibt es keine Kills, nur Angaben zur ganzen Runde wie Karte und Rundenausgang.

Kosten: Die Texterkennung auf dem Ausschnitt dürfte wenige Sekunden je Clip brauchen, statt etwa 70 s für ganze Bilder. Nicht gemessen. Trägt der Weg, liefert das Replay Karte und Rundenausgang genauer als die jetzige Texterkennung auf ganzen Bildern.

## Umsetzung: zwei Wege

| Weg                                                          | Vorteil                                                                                                 | Nachteil                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Fork als Programm `r6-dissect.exe` neben dem Client          | Liest, was der Fork kann; Korrekturen lassen sich übernehmen. Hier für Windows gebaut: 7,7 MB, ohne cgo | Go-Build in der Release-Pipeline, auf einen Commit gepinnt, weil der Fork keine Releases hat              |
| Nachbau in TypeScript (Kopf, Killfeed, Zeit; zstd über Node) | Kein fremdes Programm                                                                                   | Etwa 1.000 Zeilen Muster-Code, die mit jeder Season brechen können; hier ohne echte Dateien nicht prüfbar |

**Empfehlung:** Zuerst ein Messwerkzeug mit dem Fork als Programm. Ein Nachbau lohnt erst, wenn die Messung trägt.

## Datenschutz

- Alles läuft lokal.
- Die Dateien enthalten die Namen aller zehn Spieler. In die Analyse gehen nur die Ereignisse des eigenen Spielers; fremde Namen landen weder im Titel noch auf deinem Server.

## Messplan

| Stufe        | Wie                                                            | Erfolg                                                                                                                                            | Verwerfen                                                                             |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Lesbarkeit   | Messwerkzeug über alle vorhandenen Matches                     | Jede Runde hat Karte, Ausgang und eigenen Spieler; die eigenen Kills je Match stimmen mit der Übersicht im Spiel, in mindestens 19 von 20 Matches | Mehr als ein Match von 20 falsch: nur Karte und Ausgang nutzen oder den Weg verwerfen |
| Rundenwahl   | Alle Clips einer Session                                       | Jeder Clip bekommt die richtige Runde oder „keine“, nie eine falsche                                                                              | Eine falsche Runde in 20 Clips: Fenster enger fassen oder verwerfen                   |
| Zeit         | 20 Clips mit eigenen Kills, Clipsekunde je Kill gegen Sichtung | ≥ 90 % der Kills auf ± 1 s                                                                                                                        | > 10 % mehr als 3 s daneben: keine Kill-Sekunden, nur Rundenangaben                   |
| Kosten       | Rechenzeit Parser plus Uhr-Erkennung je Clip                   | < 10 s CPU                                                                                                                                        | Spürbares Ruckeln beim Spielen                                                        |
| Titel        | R6-Clips mit und ohne Replay-Ereignisse, von dir bewertet      | Mehr Titel, die treffen, woran du dich erinnerst (Ace, Clutch, Kopfschüsse); kein Widerspruch zum Clip                                            | Kein Gewinn gegenüber heute: Option bleibt aus                                        |
| Season-Patch | Nach dem nächsten Patch das Messwerkzeug erneut laufen lassen  | Liest weiter oder meldet eine unbekannte Version, statt Falsches zu liefern                                                                       | Falsches ohne Meldung: Plausibilitätsprüfung verschärfen oder verwerfen               |

## Nächste Schritte, wenn du sie freigibst

1. In R6 Match Replay einschalten, ein paar Matches spielen und Clips wie gewohnt speichern.
2. Ein Messwerkzeug `npm run r6-replays` bauen: Runden und eigene Kills listen, Clips zuordnen, ohne Einbau in die Analyse.
3. Den Zeitanker über die Rundenuhr im Bild ergänzen.
4. Erst nach bestandener Messung einbauen, hinter einer Option, die zunächst aus ist.
