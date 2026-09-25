import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Download,
  Folder,
  HardDrive,
  Monitor,
  Server,
  Upload,
  RefreshCw,
  BookOpen,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { useActions } from '../components/Actions';
import { useVault } from '../data/store';
import { PageHeading } from '../components/PageHeading';
import { VaultConnection } from '../components/VaultConnection';
export default function Devices() {
  const action = useActions();
  const { server, refreshServer } = useVault();
  return (
    <div className="page devices-page">
      <PageHeading
        eyebrow="DEIN PC + DEIN VAULT"
        title="Deine Geräte"
        description="Dein Aufnahme-PC und dein Archiv. An einem Ort."
      >
        <button className="button secondary" onClick={() => void refreshServer()}>
          <RefreshCw size={16} />
          Aktualisieren
        </button>
      </PageHeading>
      <div className="device-intro">
        <div className="device-intro-copy">
          <span className="surface-kicker">
            <ShieldCheck size={15} /> AUF DEINEM EIGENEN SERVER
          </span>
          <h2>
            Dein PC nimmt auf.
            <br />
            <span className="gradient-text">Dein Vault bewahrt.</span>
          </h2>
          <p>
            Der Windows-Client beobachtet deinen NVIDIA-Aufnahmeordner. Deine lokale KI erstellt
            Titel, Beschreibung und Tags. Die AgentBox archiviert den Clip mit dem Ergebnis.
          </p>
          <div className="device-downloads">
            {server.connected && server.clientDownloadAvailable ? (
              <a className="button primary" href="/api/downloads/windows" download>
                <Download size={17} />
                Windows-Client herunterladen
              </a>
            ) : (
              <div className="notice">
                <p>
                  {server.connected
                    ? 'Auf diesem Server wurde noch kein Windows-Installer bereitgestellt.'
                    : 'Verbinde zuerst deinen Archiv-Server. Danach findest du den Windows-Download hier.'}
                </p>
              </div>
            )}
            <Link
              className={
                server.connected && server.clientDownloadAvailable ? 'text-link' : 'button primary'
              }
              to="/setup"
            >
              <BookOpen size={16} />
              Zum Setup-Guide
              <ArrowRight size={15} />
            </Link>
            <button className="button secondary" onClick={() => action({ kind: 'upload' })}>
              <Upload size={17} />
              Clip manuell hinzufügen
            </button>
          </div>
          <p className="small-text muted">
            Windows 10/11 · 64 Bit · Ollama und das lokale Modell werden im Client eingerichtet.
          </p>
        </div>
        <VaultConnection />
      </div>
      <section className="device-flow">
        <div className="section-heading">
          <div>
            <span className="eyebrow">VOM ERSTEN START ZUM ERSTEN CLIP</span>
            <h2>In drei Schritten verbunden</h2>
          </div>
          <Link className="text-link" to="/setup">
            Anleitung öffnen
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="steps">
          <Link to="/setup#server">
            <span>01</span>
            <Server size={23} />
            <h3>Archiv-Server einrichten</h3>
            <p>
              ReplayHaven auf deinem Linux-Rechner oder NAS einrichten. Serveradresse und
              persönlichen Zugangsschlüssel festlegen.
            </p>
            <span className="step-link">
              Server einrichten
              <ChevronRight size={15} />
            </span>
          </Link>
          <Link to="/setup#client">
            <span>02</span>
            <Monitor size={23} />
            <h3>Windows-Client installieren</h3>
            <p>Serveradresse und Zugangsschlüssel eintragen. NVIDIA-Aufnahmeordner auswählen.</p>
            <span className="step-link">
              Client verbinden
              <ChevronRight size={15} />
            </span>
          </Link>
          <Link to="/setup#first-clip">
            <span>03</span>
            <Folder size={23} />
            <h3>Ersten Clip archivieren</h3>
            <p>
              Bei Bedarf die lokale Analyse einrichten. Warteschlange starten und eine neue Aufnahme
              in deiner Bibliothek wiederfinden.
            </p>
            <span className="step-link">
              Ersten Clip archivieren
              <ChevronRight size={15} />
            </span>
          </Link>
        </div>
      </section>
      <section className="device-example">
        <div className="section-heading">
          <h2>Verbundene Aufnahme-PCs</h2>
          <span className={`connection-status${server.connected ? ' online' : ''}`}>
            <span />
            {server.connected ? 'Server erreichbar' : 'Server nicht verbunden'}
          </span>
        </div>
        {server.devices.length ? (
          server.devices.map((device) => {
            const online = Date.now() - Date.parse(device.lastSeen) < 90000;
            return (
              <div className="device-card" key={device.id}>
                <div className="device-card-heading">
                  <span className="device-icon">
                    <Monitor size={29} />
                  </span>
                  <div>
                    <h3>{device.name}</h3>
                    <p>Letzter Kontakt: {new Date(device.lastSeen).toLocaleString('de-DE')}</p>
                  </div>
                  <span className={`connection-status${online && !device.paused ? ' online' : ''}`}>
                    <span />
                    {online ? (device.paused ? 'Pausiert' : 'Verbunden') : 'Offline'}
                  </span>
                </div>
                <div className="folder-list">
                  <div>
                    <Folder size={18} />
                    <code>{device.folder}</code>
                  </div>
                  <div>
                    {device.uploaded} bestätigte Uploads ·{' '}
                    {device.analysisLocation === 'client'
                      ? 'KI auf dem Aufnahme-PC'
                      : 'Analyse auf dem Server'}
                  </div>
                  {device.error && <p className="error small-text">{device.error}</p>}
                </div>
              </div>
            );
          })
        ) : (
          <div className="device-empty">
            <span className="device-empty-icon">
              <Monitor size={25} strokeWidth={1.5} />
            </span>
            <div>
              <h3>Dein nächster Clip beginnt hier.</h3>
              <p>
                Noch kein Aufnahme-PC verbunden. Richte deinen Client ein und verbinde ihn mit
                deinem Server. Der Browser selbst überwacht keine Windows-Ordner.
              </p>
            </div>
            <Link className="button secondary" to="/setup">
              PC verbinden
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <div className="device-card-footer">
        <HardDrive size={17} />
        <p>
          Originaldateien auf deinem PC bleiben erhalten. Das Löschen einer lokalen Aufnahme
          entfernt keine Serverkopie.
        </p>
      </div>
      <Link className="text-link" to="/settings#analysis">
        Serververbindung und KI-Einstellungen <ArrowRight size={15} />
      </Link>
    </div>
  );
}
