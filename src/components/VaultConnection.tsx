import { ArrowRight, Monitor, Play, Server } from 'lucide-react';

export function VaultConnection() {
  return (
    <div
      className="vault-connection"
      role="img"
      aria-label="Dein Aufnahme-PC überträgt Clips an deinen persönlichen Archiv-Server."
    >
      <div className="connection-orbit orbit-outer" />
      <div className="connection-orbit orbit-inner" />
      <div className="connection-topline">
        <span /> DEIN PERSÖNLICHES ARCHIV
      </div>
      <div className="connection-map">
        <div className="connection-node pc-node">
          <Monitor size={34} strokeWidth={1.3} />
          <span>Dein PC</span>
          <small>Aufnehmen</small>
        </div>
        <div className="connection-path">
          <ArrowRight size={16} />
        </div>
        <div className="connection-core">
          <Play size={24} fill="currentColor" />
        </div>
        <div className="connection-path">
          <ArrowRight size={16} />
        </div>
        <div className="connection-node vault-node">
          <Server size={34} strokeWidth={1.3} />
          <span>Dein Vault</span>
          <small>Aufbewahren</small>
        </div>
      </div>
      <div className="connection-bottomline">
        DEINE AUFNAHMEN
        <span />
        DEIN SERVER
      </div>
    </div>
  );
}
