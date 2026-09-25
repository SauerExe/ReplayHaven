# Serverbetrieb

Node.js 24, Fastify, SQLite und FFmpeg in einem Container. Der Prozess läuft als unprivilegierter Benutzer hinter `tini`. Die KI-Konfiguration ist standardmäßig `none`: Der Windows-Client liefert die Ergebnisse, der Server braucht weder GPU noch Modell.

## Dateien im Serververzeichnis

| Datei             | Zweck                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| `compose.yaml`    | Startet das Image `ghcr.io/sauerexe/replayhaven` mit Datenvolume und Port 8787        |
| `.env`            | Deine Einstellungen: Zugangsschlüssel, Browseradresse, optional Image und KI-Anbieter |
| `.env.example`    | Vorlage mit allen Variablen                                                           |
| `setup-server.sh` | Erzeugt `.env`, baut bei Bedarf aus dem Quellcode und startet den Server              |
| `release/`        | Optional: `ReplayHaven-Client-Setup.exe` für den Download direkt vom Server           |

Compose liest `.env` automatisch. Jede Variable darin erreicht auch den Container.

## Bedienung

```bash
# Erststart oder nach Änderungen an .env
docker compose up -d

# Update auf das neueste veröffentlichte Image
docker compose pull && docker compose up -d

# Update aus dem Quellcode (git pull vorher)
bash setup-server.sh

# Zustand und Protokolle
docker compose ps
docker compose logs --tail=100 -f

# Neustart oder Anhalten ohne Datenlöschung
docker compose restart
docker compose stop
```

`REPLAYHAVEN_PUBLIC_ORIGIN` muss der Adresse entsprechen, die Browser tatsächlich verwenden, inklusive Schema und Port. Andere Herkünfte werden mit 403 abgewiesen.

## Netzwerk und Zugriff von außen

Port 8787 ist für das Heimnetz vorgesehen. Für Zugriff von außen einen VPN-Zugang oder einen HTTPS-Reverse-Proxy (Caddy, nginx, Traefik) verwenden und `REPLAYHAVEN_PUBLIC_ORIGIN` auf die HTTPS-Adresse setzen. Der Proxy muss Uploads bis 2 GB und Anfragen bis 30 Minuten zulassen; bei nginx etwa `client_max_body_size 2g` und `proxy_read_timeout 1800s`.

Der gemeinsame Schlüssel schützt dieses persönliche Archiv. Benutzerkonten, Rollen und öffentliche Freigabelinks sind noch nicht implementiert. Der Browser erhält ein signiertes HttpOnly-Cookie; der Client speichert den Schlüssel mit Windows-Verschlüsselung und sendet ihn als Bearer-Token.

## Daten und Backup

Das benannte Compose-Volume `archive` enthält:

```text
vault.sqlite                   Metadaten, Einstellungen, Geräte
clips/<UUID>/original.<ext>    Unveränderte Aufnahme
clips/<UUID>/thumbnail.jpg     Vorschaubild
clips/<UUID>/playback.mp4      Optionale Wiedergabekopie
incoming/                      Laufende Uploads
covers/                        Lokal gespeicherte Spiele-Cover von Steam
```

Für ein konsistentes Backup den Container stoppen, das **gesamte Volume** sichern, dann wieder starten:

```bash
docker compose stop
docker run --rm -v replayhaven_archive:/data -v "$PWD":/backup alpine tar -czf /backup/replayhaven-backup.tar.gz -C /data .
docker compose start
```

`.env` ebenfalls sicher aufbewahren. `docker compose down` behält das Volume; `down -v` löscht es und ist kein normaler Update-Schritt. Entfernte Bibliothekseinträge behalten ihre Originale. Ein erneuter Upload desselben Inhalts stellt den Eintrag wieder her.

Wer die Daten lieber in einem Ordner statt in einem benannten Volume hat, ersetzt in `compose.yaml` die Zeile `- archive:/app/vault-data` durch `- ./data:/app/vault-data` und gibt dem Ordner die UID 1000 (`chown -R 1000:1000 data`).

## Windows-Client-Download

Der Knopf unter **Geräte** verweist in dieser Reihenfolge auf:

1. `release/ReplayHaven-Client-Setup.exe`, falls die Datei neben `compose.yaml` liegt (nur lesend eingebunden).
2. `REPLAYHAVEN_CLIENT_DOWNLOAD_URL`. Veröffentlichte Images enthalten bereits die passende GitHub-Release-Adresse.

Fehlt beides, gibt es keinen Downloadknopf.

## Verarbeitung

H.264 in MP4 wird direkt wiedergegeben. Andere Formate erhalten eine zusätzliche H.264-Wiedergabekopie mittels CPU-FFmpeg. HEVC/AV1 benötigen dadurch zusätzliche Zeit und Platz. Eine Warteschlange begrenzt gleichzeitige Serververarbeitung; laufende Aufträge werden nach Neustart erneut aufgenommen.

## Automatische Spielinfos

Der Server lädt für erkannte Spiele den offiziellen Namen, eine deutsche Kurzbeschreibung (soweit bei Steam vorhanden), Genre, Erscheinungsdatum und Cover von Steam. Ein API-Schlüssel ist nicht erforderlich. Die Funktion ist standardmäßig aktiv; `REPLAYHAVEN_GAME_METADATA=0` in `.env` schaltet neue Abrufe aus. Nach einer Änderung den Container mit `docker compose up -d` neu erstellen.

Der Abruf startet nach Uploads mit Spielnamen, nach der Spielerkennung durch Client- oder Server-KI und nach manuellen Änderungen des Spielnamens. Beim Serverstart werden vorhandene Clips nachgezogen. Nur normalisiert exakt passende Steam-Namen werden übernommen: Satzzeichen, Markenzeichen und Großschreibung dürfen abweichen; ein ähnlicher Spieletitel allein reicht nicht. Nicht bei Steam geführte Spiele und abweichende Kurznamen behalten ihren bisherigen Namen ohne erfundene Metadaten.

**IGDB als zweite Quelle (optional).** Spiele, die Steam nicht führt (Valorant, Fortnite, Minecraft und andere), findet der Server über [IGDB](https://api-docs.igdb.com/) von Twitch, kostenlos für nicht-kommerzielle Nutzung. Dafür unter https://dev.twitch.tv/console/apps eine Anwendung anlegen (Weiterleitungs-URL `http://localhost`, Kategorie „Application Integration“), dann Client-ID und ein neues Client-Secret als `REPLAYHAVEN_IGDB_CLIENT_ID` und `REPLAYHAVEN_IGDB_CLIENT_SECRET` in `.env` eintragen und den Container mit `docker compose up -d` neu erstellen. Unter **Einstellungen → Spielinfos** lassen sich danach alle Spiele neu nachschlagen. Es gilt dieselbe Regel wie bei Steam: nur exakt passende Namen, Cover im Hochformat. Beschreibungen kommen von IGDB auf Englisch.

Anfragen laufen nacheinander im Hintergrund. Die Metadaten liegen in SQLite, Cover unter `covers/`; der Browser lädt die Bilder vom eigenen Server. Fehlt das Hochformat-Cover, versucht der Server das Steam-Headerbild. Bereits gespeicherte Infos bleiben bei Ausfällen erhalten.

Ein stündlicher Durchlauf prüft fällige Abrufe: Netzfehler und unvollständige Cover frühestens nach einer Stunde, Spiele ohne Treffer nach 14 Tagen, vollständige Einträge nach 30 Tagen. Unter **Einstellungen → Spielinfos** stehen Status und Trefferzahlen. **Jetzt aktualisieren** stößt den Abruf aller Spiele im sichtbaren Archiv sofort an. Entfernte Clips werden dabei nicht berücksichtigt.

Übertragen werden der Spielname für die Suche und die gefundene Steam-App-ID für Details und Bilder; keine Clips oder Analyseergebnisse.

## Ohne Docker

```bash
npm ci
npm run build && npm run server:bundle
REPLAYHAVEN_HOST=0.0.0.0 REPLAYHAVEN_ACCESS_TOKEN=<mindestens-24-zeichen> REPLAYHAVEN_PUBLIC_ORIGIN=http://<host>:8787 \
REPLAYHAVEN_DATA_DIR=/var/lib/replayhaven node server-bundle/index.mjs
```

FFmpeg und FFprobe werden über `REPLAYHAVEN_FFMPEG` und `REPLAYHAVEN_FFPROBE` angegeben; ohne Angabe nutzt der Server die npm-Pakete `ffmpeg-static` und `@ffprobe-installer/ffprobe`.

## Optionale Server-KI

Für den Betrieb mit dem Windows-Client **nicht erforderlich**. Diese Schnittstellen sind vorbereitet, aber nicht gegen einen echten Anbieter getestet. In `.env` ergänzen:

| Variable                   | Bedeutung                                                                  |
| -------------------------- | -------------------------------------------------------------------------- |
| `REPLAYHAVEN_AI_PROVIDER`  | `none` (Standard), `local` oder `gemini`                                   |
| `REPLAYHAVEN_AI_MODEL`     | Exakte Modellkennung                                                       |
| `REPLAYHAVEN_LOCAL_AI_URL` | Erreichbare Vision-Chat-Completions-API, z. B. `http://modellhost:8000/v1` |
| `REPLAYHAVEN_LOCAL_AI_KEY` | Optionaler API-Schlüssel                                                   |
| `GEMINI_API_KEY`           | Schlüssel für ausdrücklich aktivierte Gemini-Analyse                       |

`local` sendet Bildstichproben an einen von dir betriebenen Modellserver. `gemini` überträgt eine verkleinerte Videokopie an Google und kann Kosten verursachen. Ton ist zunächst aus. Server-Analyse lässt sich danach in der Weboberfläche steuern. Uploads mit angekündigtem Client-Ergebnis verwenden weiterhin den Client-Pfad.
