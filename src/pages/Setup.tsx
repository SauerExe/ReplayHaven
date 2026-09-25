import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  KeyRound,
  Monitor,
  Play,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { PageHeading } from '../components/PageHeading';
import { VaultConnection } from '../components/VaultConnection';
import { useVault } from '../data/store';
import { useActiveSection } from '../components/useActiveSection';

const guideSections = ['server', 'client', 'first-clip', 'help'] as const;

const sourceCommand = `git clone https://github.com/SauerExe/ReplayHaven.git
cd ReplayHaven
bash setup-server.sh`;
const dockerCommand = `mkdir -p replayhaven && cd replayhaven
curl -fsSLO https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/SauerExe/ReplayHaven/main/.env.example -o .env
nano .env`;

function Command({ label, children }: { label: string; children: string }) {
  const { toast } = useVault();
  const [lastCopied, setLastCopied] = useState('');
  const copied = lastCopied === children;
  const lines = children.split('\n');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const code = useRef<HTMLElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="setup-command">
      <div className="command-heading">
        <span>
          <span className="terminal-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {label}
        </span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(children);
              setLastCopied(children);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setLastCopied(''), 2500);
            } catch {
              if (code.current) {
                const range = document.createRange();
                range.selectNodeContents(code.current);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
              }
              toast('Befehl markiert. Bitte mit Strg+C oder über das Auswahlmenü kopieren.');
            }
          }}
          aria-label={`${label} kopieren`}
          className={copied ? 'is-copied' : undefined}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span aria-live="polite">{copied ? 'Kopiert' : 'Kopieren'}</span>
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code ref={code}>
          {lines.map((line, index) => (
            <span
              className="command-line"
              data-line={String(index + 1).padStart(2, '0')}
              key={index}
            >
              {line}
              {index < lines.length - 1 ? '\n' : ''}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

const questions = [
  {
    title: 'Mein Server ist nicht erreichbar.',
    answer: (
      <>
        Öffne zuerst die Serveradresse im Browser. Prüfe auf dem Server mit{' '}
        <code>docker compose ps</code>, ob der Container läuft. Mit{' '}
        <code>docker compose logs --tail=80</code> siehst du die letzten Meldungen.
      </>
    ),
  },
  {
    title: 'Die Herkunft ist nicht freigegeben oder der Schlüssel wird abgelehnt.',
    answer: (
      <>
        <code>REPLAYHAVEN_PUBLIC_ORIGIN</code> in der <code>.env</code> muss genau zur
        Browseradresse passen, inklusive http/https und Port. Starte danach mit{' '}
        <code>docker compose up -d</code> neu. Den Zugangsschlüssel findest du ebenfalls in der{' '}
        <code>.env</code>.
      </>
    ),
  },
  {
    title: 'Unter Geräte wird kein Windows-Download angezeigt.',
    answer: (
      <>
        Verbinde zuerst deinen Server in den Einstellungen. Fehlt der Download weiterhin, hinterlege
        den Installer im Serverordner <code>release/</code> oder setze{' '}
        <code>REPLAYHAVEN_CLIENT_DOWNLOAD_URL</code> in der <code>.env</code>.
      </>
    ),
  },
  {
    title: 'Kann ich erst einmal ohne lokale KI starten?',
    answer: (
      <>
        Ja. Schalte im Client „Neue Clips vor dem Upload lokal analysieren“ aus. Deine Originale
        werden dann ohne KI-Ergebnis archiviert. Alternativ kannst du einen Clip direkt im Browser
        hochladen.
      </>
    ),
  },
  {
    title: 'Was passiert mit meinen Originalaufnahmen?',
    answer: (
      <>
        Deine Dateien auf dem PC werden weder umbenannt noch verschoben oder gelöscht. Löschst du
        eine lokale Aufnahme, bleibt ihre Serverkopie erhalten. Sichere für ein Backup das gesamte
        Archiv-Volume und die Serverkonfiguration.
      </>
    ),
  },
];

export default function Setup() {
  const { server } = useVault();
  const [method, setMethod] = useState<'docker' | 'source'>('docker');
  const current = useActiveSection(guideSections);
  const currentStep = Math.min(
    guideSections.indexOf(current as (typeof guideSections)[number]) + 1,
    3,
  );
  return (
    <div className="page setup-page">
      <PageHeading
        eyebrow="WILLKOMMEN IN DEINEM VAULT"
        title="Setup-Guide"
        description="Von der ersten Verbindung bis zu deinem ersten Clip."
      >
        <Link className="button secondary" to="/devices">
          <Monitor size={17} />
          Deine Geräte
        </Link>
      </PageHeading>
      <section className="setup-hero">
        <div className="setup-hero-copy">
          <span className="surface-kicker">
            <BookOpen size={15} /> LOS GEHT’S
          </span>
          <h2>
            Dein Vault.
            <br />
            <span className="gradient-text">In drei Schritten.</span>
          </h2>
          <p>
            Dein Server bewahrt die Aufnahmen. Dein PC liefert die Clips. Hier richtest du beides
            ein.
          </p>
          <a className="button primary" href="#server">
            Einrichtung starten
            <ArrowRight size={17} />
          </a>
          <span className="hero-footnote">
            <ShieldCheck size={14} /> Originale bleiben auf deinem PC erhalten.
          </span>
        </div>
        <VaultConnection />
        <div className="setup-requirements">
          <span>
            <Server size={16} />
            <span>
              Server<small>Linux oder NAS mit Docker</small>
            </span>
          </span>
          <span>
            <Monitor size={16} />
            <span>
              Aufnahme-PC<small>Windows 10 / 11 · 64 Bit</small>
            </span>
          </span>
          <span>
            <HardDrive size={16} />
            <span>
              Speicherplatz<small>Für deine Originalaufnahmen</small>
            </span>
          </span>
        </div>
      </section>
      <div className="setup-layout">
        <nav className="setup-nav" aria-label="Einrichtungsschritte">
          <div className="guide-position">
            <span>{current === 'help' ? 'HILFE & ANTWORTEN' : 'DEIN WEG INS ARCHIV'}</span>
            <strong>
              {String(currentStep).padStart(2, '0')}
              <span> / 03</span>
            </strong>
            <div aria-hidden="true">
              <span style={{ width: `${(currentStep / 3) * 100}%` }} />
            </div>
          </div>
          <a href="#server" aria-current={current === 'server' ? 'location' : undefined}>
            <span>01</span>
            <div>
              Server einrichten<small>Das Zuhause deiner Clips</small>
            </div>
            <ArrowRight size={14} />
          </a>
          <a href="#client" aria-current={current === 'client' ? 'location' : undefined}>
            <span>02</span>
            <div>
              PC verbinden<small>Deine Aufnahmen anbinden</small>
            </div>
            <ArrowRight size={14} />
          </a>
          <a href="#first-clip" aria-current={current === 'first-clip' ? 'location' : undefined}>
            <span>03</span>
            <div>
              Ersten Clip archivieren<small>Aufnehmen und wiederfinden</small>
            </div>
            <ArrowRight size={14} />
          </a>
          <a
            className="setup-help-link"
            href="#help"
            aria-current={current === 'help' ? 'location' : undefined}
          >
            <BookOpen size={16} />
            Hilfe bei der Einrichtung
          </a>
          <div className={`setup-server-state${server.connected ? ' online' : ''}`}>
            <span className="server-status-dot" />
            <div>
              {server.connected ? 'Dein Server ist verbunden' : 'Noch kein Server verbunden'}
              <small>Status dieser Browser-Verbindung</small>
            </div>
          </div>
        </nav>
        <div className="setup-sections">
          <section className="guide-section" id="server" aria-labelledby="server-title">
            <header className="guide-section-heading">
              <span className="guide-number">01</span>
              <div>
                <span className="eyebrow">DIE BASIS</span>
                <h2 id="server-title">Dein Server. Dein Archiv.</h2>
              </div>
              <Server size={24} strokeWidth={1.4} />
            </header>
            <p>
              Du brauchst einen Linux-Rechner oder ein NAS mit Docker Engine und Compose-Plugin. Auf
              dem Server ist für die Analyse auf deinem PC kein KI-Modell nötig.
            </p>
            <div className="setup-methods" role="group" aria-label="Installationsmethode">
              <button
                type="button"
                aria-pressed={method === 'docker'}
                onClick={() => setMethod('docker')}
              >
                Docker-Image<span>Empfohlen</span>
              </button>
              <button
                type="button"
                aria-pressed={method === 'source'}
                onClick={() => setMethod('source')}
              >
                Aus dem Quellcode
              </button>
            </div>
            <p className="guide-instruction">
              {method === 'docker'
                ? 'Öffne ein Terminal auf deinem Server und lade die Konfiguration herunter.'
                : 'Öffne ein Terminal auf deinem Server. Das Setup-Skript führt dich durch die Einrichtung.'}
            </p>
            <Command label="Server vorbereiten">
              {method === 'docker' ? dockerCommand : sourceCommand}
            </Command>
            {method === 'docker' ? (
              <>
                <div className="guide-callout">
                  <KeyRound size={19} />
                  <div>
                    <h3>Deine Verbindung konfigurieren</h3>
                    <p>
                      Trage in der geöffneten <code>.env</code> einen eigenen{' '}
                      <code>REPLAYHAVEN_ACCESS_TOKEN</code> und deine Browseradresse als{' '}
                      <code>REPLAYHAVEN_PUBLIC_ORIGIN</code> ein, inklusive Protokoll und Port.
                      Einen Schlüssel erzeugst du in einem zweiten Terminal mit{' '}
                      <code>openssl rand -hex 24</code>. Speichere anschließend die Datei.
                    </p>
                  </div>
                </div>
                <Command label="Server starten">docker compose up -d</Command>
              </>
            ) : (
              <div className="guide-callout">
                <KeyRound size={19} />
                <div>
                  <h3>Den Zugangsschlüssel aufbewahren</h3>
                  <p>
                    Das Skript fragt deine Serveradresse ab, erzeugt deinen Zugangsschlüssel und
                    startet den Server. Den Schlüssel brauchst du genau einmal: beim Anlegen deines
                    Kontos. Der erste Build benötigt Internet und einige Minuten.
                  </p>
                </div>
              </div>
            )}
            <div className="guide-next">
              <p>
                <Check size={16} />
                Öffne deine Serveradresse im Browser und leg dein Konto an. Weitere Geräte meldest
                du danach unter Geräte per QR-Code an.
              </p>
              <Link className="text-link" to="/settings#analysis">
                Zu den Einstellungen
                <ArrowRight size={15} />
              </Link>
            </div>
          </section>
          <a className="guide-continue" href="#client">
            <span>WEITER MIT SCHRITT 02</span>Deinen Aufnahme-PC verbinden
            <ArrowRight size={17} />
          </a>
          <section className="guide-section" id="client" aria-labelledby="client-title">
            <header className="guide-section-heading">
              <span className="guide-number">02</span>
              <div>
                <span className="eyebrow">DIE VERBINDUNG</span>
                <h2 id="client-title">Bring deinen PC ins Spiel.</h2>
              </div>
              <Monitor size={25} strokeWidth={1.4} />
            </header>
            <p>
              Der Windows-Client verbindet deinen Aufnahmeordner mit dem Archiv. Node.js, Python und
              FFmpeg musst du nicht separat installieren.
            </p>
            <div className="client-download-card">
              <span className="download-symbol">
                <Download size={23} />
              </span>
              <div>
                <h3>ReplayHaven für Windows</h3>
                <p>Windows 10 / 11 · 64 Bit</p>
              </div>
              {server.connected && server.clientDownloadAvailable ? (
                <a href="/api/downloads/windows" download className="button primary">
                  <Download size={16} />
                  Herunterladen
                </a>
              ) : (
                <Link to="/devices" className="button secondary">
                  Zum Download
                  <ArrowRight size={16} />
                </Link>
              )}
            </div>
            {!(server.connected && server.clientDownloadAvailable) && (
              <p className="guide-caption">
                Der Download erscheint unter Geräte, sobald dein Server verbunden ist und ein
                Installer bereitsteht.
              </p>
            )}
            <ol className="guide-checklist">
              <li>
                <span>
                  <Monitor size={17} />
                </span>
                <div>
                  <h3>Client installieren und öffnen</h3>
                  <p>Führe den Windows-Installer aus und öffne ReplayHaven Client.</p>
                </div>
              </li>
              <li>
                <span>
                  <KeyRound size={17} />
                </span>
                <div>
                  <h3>Mit deinem Server koppeln</h3>
                  <p>
                    Trag im Client nur die Serveradresse ein. Er zeigt einen Code; unter Geräte
                    erscheint derselbe, und du klickst auf Freigeben.
                  </p>
                </div>
              </li>
              <li>
                <span>
                  <FolderOpen size={17} />
                </span>
                <div>
                  <h3>Deinen Aufnahmeordner auswählen</h3>
                  <p>
                    Wähle den Ordner, in dem deine Aufnahme-App Clips speichert. Unterordner werden
                    ebenfalls berücksichtigt.
                  </p>
                </div>
              </li>
            </ol>
            <div className="guide-callout">
              <FolderOpen size={19} />
              <div>
                <h3>Du hast schon Aufnahmen?</h3>
                <p>
                  Aktiviere „Vorhandene Aufnahmen beim ersten Start mitnehmen“, bevor du die
                  Warteschlange zum ersten Mal startest, wenn deine bisherigen Clips ebenfalls ins
                  Archiv sollen.
                </p>
              </div>
            </div>
          </section>
          <a className="guide-continue" href="#first-clip">
            <span>WEITER MIT SCHRITT 03</span>Deinen ersten Clip archivieren
            <ArrowRight size={17} />
          </a>
          <section className="guide-section" id="first-clip" aria-labelledby="first-clip-title">
            <header className="guide-section-heading">
              <span className="guide-number">03</span>
              <div>
                <span className="eyebrow">DEIN ERSTER MOMENT</span>
                <h2 id="first-clip-title">Aufnehmen. Wiederfinden.</h2>
              </div>
              <Play size={23} strokeWidth={1.4} />
            </header>
            <p>
              Richte bei Bedarf die lokale Analyse über die Ollama- und Modell-Schaltflächen im
              Client ein. Starte anschließend „Analyse & Upload starten“ und speichere einen neuen
              Clip wie gewohnt.
            </p>
            <div className="first-clip-flow">
              <span>
                <FolderOpen size={21} />
                <strong>Clip speichern</strong>
                <small>In deinem Aufnahmeordner</small>
              </span>
              <ArrowRight size={17} />
              <span>
                <Monitor size={21} />
                <strong>Client verarbeitet</strong>
                <small>Analyse & Upload</small>
              </span>
              <ArrowRight size={17} />
              <span>
                <Check size={21} />
                <strong>Im Vault ansehen</strong>
                <small>In deiner Bibliothek</small>
              </span>
            </div>
            <p className="guide-caption">
              Warte, bis die Datei fertig geschrieben und der Upload bestätigt ist. Für den ersten
              Verbindungstest kannst du die lokale Analyse im Client ausschalten.
            </p>
            <div className="guide-next">
              <p>
                <ShieldCheck size={16} />
                Deine lokale Originaldatei bleibt erhalten.
              </p>
              <Link className="button primary" to="/library">
                Bibliothek öffnen
                <ArrowRight size={16} />
              </Link>
            </div>
          </section>
          <section className="setup-faq" id="help" aria-labelledby="help-title">
            <span className="eyebrow">WENN ETWAS HAKT</span>
            <h2 id="help-title">Ein guter nächster Schritt.</h2>
            {questions.map((question) => (
              <details key={question.title}>
                <summary>
                  {question.title}
                  <ChevronDown size={17} />
                </summary>
                <p>{question.answer}</p>
              </details>
            ))}
            <a
              className="text-link"
              href="https://github.com/SauerExe/ReplayHaven/blob/main/docs/SERVER.md"
              target="_blank"
              rel="noreferrer"
            >
              Ausführliche Server-Dokumentation
              <ExternalLink size={14} />
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
