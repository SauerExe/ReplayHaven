import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock3, RefreshCw, Sparkles, Play, AlertCircle } from 'lucide-react';
import type { Clip } from '../domain/models';
import { useVault } from '../data/store';
import { time } from '../data/repository';
const statusText = {
  not_configured: 'Noch kein KI-Ergebnis',
  idle: 'Bereit für die Analyse',
  queued: 'In der Warteschlange',
  preparing: 'Aufnahme wird vorbereitet',
  analyzing: 'KI schaut sich deinen Clip an',
  ready: 'Dein Moment, zusammengefasst',
  error: 'Analyse nicht abgeschlossen',
  awaiting_client: 'Warte auf das Ergebnis vom PC',
};
export function AnalysisPanel({ clip, onSeek }: { clip: Clip; onSeek: (seconds: number) => void }) {
  const { server, analyzeClip, patchClip, toast, refreshServer } = useVault();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(
    clip.description || clip.analysis?.result?.description || '',
  );
  if (!clip.server) return null;
  const analysis = clip.analysis;
  const result = analysis?.result;
  const status = analysis?.status || 'idle';
  const running = ['queued', 'preparing', 'analyzing'].includes(status);
  async function analyze() {
    setBusy(true);
    try {
      await analyzeClip(clip.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Analyse nicht möglich.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="analysis-panel">
      <div className="analysis-heading">
        <div className="analysis-symbol">
          <Sparkles size={20} />
        </div>
        <div>
          <span className="eyebrow">KI-ASSISTENT</span>
          <h2>{statusText[status]}</h2>
        </div>
        <span className={`analysis-status ${running ? 'working' : ''}`}>
          {running ? (
            <Clock3 size={14} />
          ) : status === 'ready' ? (
            <Check size={14} />
          ) : (
            <AlertCircle size={14} />
          )}{' '}
          {status === 'ready'
            ? 'KI-Vorschlag'
            : running
              ? 'In Arbeit'
              : status === 'error'
                ? 'Fehler'
                : 'Ausstehend'}
        </span>
      </div>
      {result ? (
        <>
          <div className="analysis-suggestion">
            <span className="muted">Titelvorschlag</span>
            <h3>{result.title}</h3>
            <button
              className="text-button"
              disabled={clip.title === result.title}
              onClick={() => patchClip(clip.id, { title: result.title })}
            >
              <Check size={14} />
              {clip.title === result.title ? 'Titel übernommen' : 'Titel übernehmen'}
            </button>
          </div>
          {editing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (await patchClip(clip.id, { description })) setEditing(false);
              }}
            >
              <label className="field">
                Beschreibung bearbeiten
                <textarea
                  maxLength={1800}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button primary" type="submit">
                  Speichern
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  Abbrechen
                </button>
              </div>
            </form>
          ) : (
            <div className="analysis-description">
              <p>{clip.description || result.description}</p>
              <button
                className="text-button"
                onClick={() => {
                  setDescription(clip.description || result.description);
                  setEditing(true);
                }}
              >
                Beschreibung bearbeiten
              </button>
            </div>
          )}
          <div className="analysis-tags">
            {result.game && <span className="tag">{result.game}</span>}
            {result.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
            <button
              className="text-button"
              onClick={() =>
                patchClip(clip.id, {
                  // Der Ordnername ist die verlässlichere Quelle; die Schätzung füllt nur Lücken.
                  gameName: clip.gameName || result.game,
                  tags: [...new Set([...clip.tags, ...result.tags])].slice(0, 20),
                })
              }
            >
              Spiel & Tags übernehmen
            </button>
          </div>
          {result.highlights.length > 0 && (
            <div className="analysis-moments">
              <h3>Interessante Stellen</h3>
              {result.highlights.map((moment, i) => (
                <button
                  className="moment"
                  key={`${moment.seconds}-${i}`}
                  onClick={() => onSeek(moment.seconds)}
                >
                  <span className="moment-time">
                    <Play size={12} />
                    {time(moment.seconds)}
                  </span>
                  <span>
                    <strong>{moment.title}</strong>
                    {moment.description && <small>{moment.description}</small>}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="analysis-footnote">
            KI-Vorschlag · Sicherheit:{' '}
            {result.confidence === 'high'
              ? 'hoch'
              : result.confidence === 'medium'
                ? 'mittel'
                : 'gering'}{' '}
            ·{' '}
            {analysis?.input === 'frames'
              ? 'Bildstichprobe, ohne Ton'
              : analysis?.input === 'video_audio'
                ? 'Video und Ton'
                : 'Video, ohne Ton'}
            {result.uncertainty && ` · ${result.uncertainty}`}
          </p>
        </>
      ) : (
        <p className="analysis-explanation">
          {analysis?.error ||
            (status === 'awaiting_client'
              ? 'Dein Video ist gespeichert. Der Windows-Client überträgt das Analyseergebnis. Lass ihn dafür weiterlaufen; bei Verbindungsfehlern versucht er es erneut.'
              : running
                ? 'Dein Original ist gespeichert. Du kannst die Seite verlassen; die Verarbeitung läuft auf dem Server weiter.'
                : server.configured
                  ? 'Die KI schlägt einen Titel, eine Beschreibung, Tags und interessante Stellen vor.'
                  : 'Aktiviere die lokale KI im Windows-Client, damit zukünftige Aufnahmen vor dem Upload analysiert werden. Browser-Uploads erhalten ohne zusätzliche Server-KI keinen automatischen Titel.')}
        </p>
      )}
      {analysis?.error && result && <p className="error small-text">{analysis.error}</p>}
      <div className="analysis-actions">
        {server.configured && clip.status === 'ready' ? (
          <button
            className="button secondary"
            disabled={running || busy || !server.connected}
            onClick={() => void analyze()}
          >
            <RefreshCw size={15} />
            {result ? 'Erneut analysieren' : 'Clip analysieren'}
          </button>
        ) : (
          <Link className="text-link" to="/devices">
            {analysis?.provider === 'client'
              ? 'Lokal auf deinem Aufnahme-PC analysiert · Geräte öffnen'
              : 'Windows-Client einrichten'}
          </Link>
        )}
        {(running || status === 'awaiting_client') && (
          <button className="text-button" onClick={() => void refreshServer()}>
            Status aktualisieren
          </button>
        )}
        {server.provider === 'gemini' && (
          <span>
            Analyse über Gemini{server.settings.includeAudio ? ' einschließlich Ton' : ''}
          </span>
        )}
      </div>
    </section>
  );
}
