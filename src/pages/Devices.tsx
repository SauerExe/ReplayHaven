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
} from 'lucide-react';
import { useActions } from '../components/Actions';
import { useVault } from '../data/store';
export default function Devices() {
  const action = useActions();
  const { server, refreshServer } = useVault();
  return (
    <div className="page devices-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEIN PC + DEINE AGENTBOX</span>
          <h1>Deine Geräte</h1>
          <p>Aufnehmen, lokal verstehen und auf deinem Server behalten.</p>
        </div>
        <button className="button secondary" onClick={() => void refreshServer()}>
          <RefreshCw size={16} />
          Aktualisieren
        </button>
      </div>
      <div className="device-intro">
        <div className="device-illustration">
          <div className="computer-outline">
            <Monitor size={72} strokeWidth={1} />
            <span className="device-dot" />
          </div>
          <span className="connection-dashes" />
          <div className="server-outline">
            <Server size={45} strokeWidth={1} />
          </div>
        </div>
        <h2>Dein PC analysiert. Dein Vault bewahrt.</h2>
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
          <button className="button secondary" onClick={() => action({ kind: 'upload' })}>
            <Upload size={17} />
            Clip manuell hinzufügen
          </button>
        </div>
        <p className="small-text muted">
          Windows 10/11 · 64 Bit · Ollama und das lokale Modell werden im Client eingerichtet.
        </p>
      </div>
      <section className="device-flow">
        <h2>In drei Schritten verbunden</h2>
        <div className="steps">
          <div>
            <span>01</span>
            <Server size={23} />
            <h3>AgentBox einrichten</h3>
            <p>
              Serverpaket auf Ubuntu entpacken und das Setup starten. Es erstellt deinen
              persönlichen Zugangsschlüssel.
            </p>
          </div>
          <div>
            <span>02</span>
            <Monitor size={23} />
            <h3>Windows-Client installieren</h3>
            <p>Serveradresse und Zugangsschlüssel eintragen. NVIDIA-Aufnahmeordner auswählen.</p>
          </div>
          <div>
            <span>03</span>
            <Folder size={23} />
            <h3>Lokale KI bereitmachen</h3>
            <p>
              Ollama installieren, im Client das Modell laden und die Warteschlange starten. Beim
              Spielen kannst du pausieren.
            </p>
          </div>
        </div>
      </section>
      <section className="device-example">
        <div className="section-heading">
          <h2>Verbundene Aufnahme-PCs</h2>
          <span className="demo-label">
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
                  <span className="offline-pill">
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
          <div className="notice">
            <Monitor size={21} />
            <p>
              Noch kein Aufnahme-PC verbunden. Starte den installierten Client mit der Adresse
              deiner AgentBox. Der Browser selbst überwacht keine Windows-Ordner.
            </p>
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
