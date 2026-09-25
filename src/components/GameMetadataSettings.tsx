import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../data/api';
import { useVault } from '../data/store';
import { SettingsSection } from './SettingsSection';

export function GameMetadataSettings() {
  const { server, refreshServer, toast } = useVault();
  const [refreshing, setRefreshing] = useState(false);
  const metadata = server.gameMetadata;
  const busy = refreshing || !!metadata?.pending;

  async function refresh() {
    setRefreshing(true);
    try {
      const { queued } = await api<{ queued: number }>('/games/refresh', { method: 'POST' });
      toast(
        queued
          ? `Spielinfos für ${queued} Spiele werden aktualisiert.`
          : 'Alle Spiele sind bereits eingeplant.',
      );
      await refreshServer();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Spielinfos konnten nicht abgerufen werden.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SettingsSection
      id="games"
      title="Spielinfos"
      description="Cover und Hintergrundinfos für deine Spiele."
    >
      <div className="settings-card">
        <div className="setting-row">
          <div>
            <h3>Automatisch von Steam</h3>
            <p>
              Sobald ein Spiel erkannt wird, ergänzt dein Server Cover, Beschreibung, Genre und
              Erscheinungsdatum. Dafür brauchst du keinen API-Schlüssel.
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={!server.connected || !metadata?.enabled || !metadata.total || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? 'Wird aktualisiert …' : 'Jetzt aktualisieren'}
          </button>
        </div>
        <div className="setting-row">
          <div role="status">
            <h3>
              {!server.connected
                ? 'Kein Server verbunden'
                : !metadata
                  ? 'Server-Update erforderlich'
                  : metadata.enabled
                    ? 'Automatischer Abruf aktiv'
                    : 'Automatischer Abruf deaktiviert'}
            </h3>
            <p>
              {!server.connected
                ? 'Verbinde deinen Archiv-Server, um Spielinfos automatisch zu laden.'
                : !metadata
                  ? 'Aktualisiere deinen Server, um den Abruf hier zu steuern.'
                  : !metadata.enabled
                    ? 'Auf diesem Server ausgeschaltet. Gespeicherte Spielinfos bleiben verfügbar.'
                    : !metadata.total
                      ? 'Der Abruf startet, sobald ein archivierter Clip einem Spiel zugeordnet ist.'
                      : `${metadata.matched} von ${metadata.total} Spielen mit Infos · ${metadata.missing} ohne eindeutigen Treffer`}
            </p>
            {server.connected && metadata?.enabled && !!metadata.pending && (
              <p>{metadata.pending} Spiele werden gerade abgefragt.</p>
            )}
            {server.connected && metadata?.enabled && !!metadata.failed && (
              <p>
                {metadata.failed} Abrufe konnten nicht vollständig geladen werden und werden
                automatisch erneut versucht.
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="settings-footnote">
        An Steam geht nur der Spielname. Die Infos und Cover bleiben auf deinem Server gespeichert.
        Ohne eindeutigen Steam-Treffer bleibt der vorhandene Spielname erhalten.
      </p>
    </SettingsSection>
  );
}
