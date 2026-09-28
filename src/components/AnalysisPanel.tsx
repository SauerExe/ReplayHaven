import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock3, RefreshCw, Sparkles, Play, AlertCircle } from 'lucide-react';
import type { Clip } from '../domain/models';
import { useVault } from '../data/store';
import { useCanEdit } from './AuthGate';
import { time } from '../data/repository';
import { t, tagLabel } from '../i18n';
export function AnalysisPanel({ clip, onSeek }: { clip: Clip; onSeek: (seconds: number) => void }) {
  const { server, analyzeClip, patchClip, toast, refreshServer } = useVault();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  // Plain accounts see the result but cannot apply it or start a new analysis.
  const editable = useCanEdit(clip);
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
      toast(e instanceof Error ? e.message : t('app.analysis.failed'));
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
          <span className="eyebrow">{t('app.analysis.eyebrow')}</span>
          <h2>{t(`app.analysis.status.${status}`)}</h2>
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
            ? t('app.analysis.badge.suggestion')
            : running
              ? t('app.analysis.badge.working')
              : status === 'error'
                ? t('app.analysis.badge.error')
                : t('app.analysis.badge.pending')}
        </span>
      </div>
      {result ? (
        <>
          <div className="analysis-suggestion">
            <span className="muted">{t('app.analysis.titleSuggestion')}</span>
            <h3>{result.title}</h3>
            {editable && (
              <button
                className="text-button"
                disabled={clip.title === result.title}
                onClick={() => patchClip(clip.id, { title: result.title })}
              >
                <Check size={14} />
                {clip.title === result.title
                  ? t('app.analysis.titleApplied')
                  : t('app.analysis.applyTitle')}
              </button>
            )}
          </div>
          {editing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (await patchClip(clip.id, { description })) setEditing(false);
              }}
            >
              <label className="field">
                {t('app.analysis.editDescription')}
                <textarea
                  maxLength={1800}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button primary" type="submit">
                  {t('common.save')}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setEditing(false)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <div className="analysis-description">
              <p>{clip.description || result.description}</p>
              {editable && (
                <button
                  className="text-button"
                  onClick={() => {
                    setDescription(clip.description || result.description);
                    setEditing(true);
                  }}
                >
                  {t('app.analysis.editDescription')}
                </button>
              )}
            </div>
          )}
          <div className="analysis-tags">
            {result.game && <span className="tag">{result.game}</span>}
            {result.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tagLabel(tag)}
              </span>
            ))}
            {editable && (
              <button
                className="text-button"
                onClick={() =>
                  patchClip(clip.id, {
                    // The folder name is the more reliable source; the AI's guess only fills gaps.
                    gameName: clip.gameName || result.game,
                    tags: [...new Set([...clip.tags, ...result.tags])].slice(0, 20),
                  })
                }
              >
                {t('app.analysis.applyGameTags')}
              </button>
            )}
          </div>
          {result.highlights.length > 0 && (
            <div className="analysis-moments">
              <h3>{t('app.analysis.moments')}</h3>
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
            {t('app.analysis.footnote', {
              confidence: t(`app.analysis.confidence.${result.confidence}`),
              input: t(
                `app.analysis.input.${analysis?.input === 'frames' || analysis?.input === 'video_audio' ? analysis.input : 'video'}`,
              ),
            })}
            {result.uncertainty && ` · ${result.uncertainty}`}
          </p>
        </>
      ) : (
        <p className="analysis-explanation">
          {analysis?.error ||
            (status === 'awaiting_client'
              ? t('app.analysis.explain.awaitingClient')
              : running
                ? t('app.analysis.explain.running')
                : server.configured
                  ? t('app.analysis.explain.configured')
                  : t('app.analysis.explain.notConfigured'))}
        </p>
      )}
      {analysis?.error && result && <p className="error small-text">{analysis.error}</p>}
      <div className="analysis-actions">
        {!editable ? null : server.configured && clip.status === 'ready' ? (
          <button
            className="button secondary"
            disabled={running || busy || !server.connected}
            onClick={() => void analyze()}
          >
            <RefreshCw size={15} />
            {result ? t('app.analysis.reanalyze') : t('app.analysis.analyze')}
          </button>
        ) : (
          <Link className="text-link" to="/settings/pcs">
            {analysis?.provider === 'client'
              ? t('app.analysis.analyzedOnPc')
              : t('app.analysis.setupClient')}
          </Link>
        )}
        {(running || status === 'awaiting_client') && (
          <button className="text-button" onClick={() => void refreshServer()}>
            {t('app.analysis.refreshStatus')}
          </button>
        )}
        {server.provider === 'gemini' && (
          <span>
            {server.settings.includeAudio
              ? t('app.analysis.geminiAudio')
              : t('app.analysis.gemini')}
          </span>
        )}
      </div>
    </section>
  );
}
