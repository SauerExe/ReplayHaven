import { useId, useMemo } from 'react';
import { Film, Heart, Info, Play, Sparkles, Upload } from 'lucide-react';
import { t, tagLabel } from '../i18n';
import { confidenceLabel, formatDuration, formatWhen, isNew, titleSize } from './format';
import type { Navigate } from './links';
import type { StreamClip, StreamLibrary, StreamStatus } from './model';
import { Picture } from './Picture';
import { Row } from './Row';
import { buildRows, pickHero, type StreamRow } from './rows';
import { ClipTile, CollectionTile, ConnectFolderTile, GameTile } from './Tile';

export interface StreamingHomeProps {
  library: StreamLibrary;
  /** Reference time for "New" and "Today, 9:14 PM". */
  now: number;
  status?: StreamStatus;
  onOpenClip: (id: string) => void;
  onPlayClip: (id: string) => void;
  /** Missing for accounts that may not change clips; the heart is hidden then. */
  onToggleFavorite?: (id: string) => void;
  onNavigate?: Navigate;
  onAddClip?: () => void;
  onCreateCollection?: () => void;
  /** Target of the dashed "Connect recording folder" tile, e.g. /devices. */
  connectHref?: string;
}

export function StreamingHome({
  library,
  now,
  status,
  onOpenClip,
  onPlayClip,
  onToggleFavorite,
  onNavigate,
  onAddClip,
  onCreateCollection,
  connectHref,
}: StreamingHomeProps) {
  const hero = useMemo(() => pickHero(library.clips), [library.clips]);
  const rows = useMemo(() => buildRows(library, now), [library, now]);

  function renderRow(row: StreamRow) {
    if (row.kind === 'clips')
      return (
        <Row key={row.id} title={row.title} kind="clips" href={row.href} onNavigate={onNavigate}>
          {row.items.map((item) => (
            <li key={item.clip.id} className="stream-row-item">
              <ClipTile item={item} variant={row.variant} onOpen={onOpenClip} onPlay={onPlayClip} />
            </li>
          ))}
        </Row>
      );
    if (row.kind === 'games')
      return (
        <Row key={row.id} title={row.title} kind="games" href={row.href} onNavigate={onNavigate}>
          {row.items.map((item) => (
            <li key={item.key} className="stream-row-item">
              <GameTile item={item} onNavigate={onNavigate} />
            </li>
          ))}
          {connectHref && (
            <li className="stream-row-item">
              <ConnectFolderTile href={connectHref} onNavigate={onNavigate} />
            </li>
          )}
        </Row>
      );
    return (
      <Row
        key={row.id}
        title={row.title}
        kind="collections"
        href={row.href}
        onNavigate={onNavigate}
        action={
          row.id === 'sammlungen' && onCreateCollection
            ? { label: t('stream.home.newCollection'), onClick: onCreateCollection }
            : undefined
        }
      >
        {row.items.map((item) => (
          <li key={item.id} className="stream-row-item">
            <CollectionTile item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </Row>
    );
  }

  return (
    <div className="stream stream-home">
      {hero ? (
        <Hero
          clip={hero}
          now={now}
          onPlay={onPlayClip}
          onOpen={onOpenClip}
          onToggleFavorite={onToggleFavorite}
        />
      ) : (
        <div className="stream-empty">
          <span className="stream-empty-icon">
            <Film size={34} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h1>{t('stream.home.emptyTitle')}</h1>
          <p>{t('stream.home.emptyText')}</p>
          {onAddClip && (
            <button
              type="button"
              className="stream-button stream-button--primary"
              onClick={onAddClip}
            >
              <Upload size={20} aria-hidden="true" />
              {t('stream.home.addClip')}
            </button>
          )}
        </div>
      )}
      {rows.length > 0 && <div className="stream-rows">{rows.map(renderRow)}</div>}
      {status && (
        <p className="stream-footer">
          <span
            className="stream-footer-dot"
            data-connected={status.connected}
            aria-hidden="true"
          />
          {status.text}
        </p>
      )}
    </div>
  );
}

function Hero({
  clip,
  now,
  onPlay,
  onOpen,
  onToggleFavorite,
}: {
  clip: StreamClip;
  now: number;
  onPlay: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
}) {
  const titleId = useId();
  return (
    <section className="stream-hero" aria-labelledby={titleId}>
      <div className="stream-hero-art">
        <Picture src={clip.thumbnail} className="stream-hero-img" sizes="100vw" eager />
      </div>
      <div className="stream-hero-shade" aria-hidden="true" />
      <div className="stream-hero-content">
        <p className="stream-hero-eyebrow">
          <span className="stream-hero-game">{clip.game}</span>
          {isNew(clip.recordedAt, now) && (
            <>
              <span className="stream-dot" aria-hidden="true" />
              <span className="stream-pill">{t('stream.tile.new')}</span>
            </>
          )}
        </p>
        <h1 id={titleId} className="stream-hero-title" data-size={titleSize(clip.title)}>
          {clip.title}
        </h1>
        <p className="stream-hero-meta">
          <span>{formatWhen(clip.recordedAt, now)}</span>
          <span className="stream-sep" aria-hidden="true">
            ·
          </span>
          <span>{formatDuration(clip.duration)}</span>
          {clip.resolution && (
            <>
              <span className="stream-sep" aria-hidden="true">
                ·
              </span>
              <span className="stream-res">{clip.resolution}</span>
            </>
          )}
        </p>
        {clip.description && <p className="stream-hero-description">{clip.description}</p>}
        {clip.tags.length > 0 && (
          <ul className="stream-hero-tags" aria-label={t('stream.tags')}>
            {clip.tags.slice(0, 4).map((tag) => (
              <li key={tag}>{tagLabel(tag)}</li>
            ))}
          </ul>
        )}
        <div className="stream-hero-actions">
          <button
            type="button"
            className="stream-button stream-button--primary"
            onClick={() => onPlay(clip.id)}
          >
            <Play size={24} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            {t('stream.play')}
          </button>
          <button
            type="button"
            className="stream-button stream-button--secondary"
            onClick={() => onOpen(clip.id)}
          >
            <Info size={24} strokeWidth={2} aria-hidden="true" />
            {t('stream.details')}
          </button>
          {onToggleFavorite && (
            <button
              type="button"
              className="stream-round stream-round--large"
              aria-label={t('stream.favorite')}
              aria-pressed={clip.favorite}
              onClick={() => onToggleFavorite(clip.id)}
            >
              <Heart
                size={22}
                strokeWidth={2}
                fill={clip.favorite ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>
      {clip.hasAnalysis && (
        <p className="stream-hero-note">
          <Sparkles size={18} strokeWidth={2} aria-hidden="true" />
          {clip.confidence
            ? t('stream.home.aiTitleConfidence', { confidence: confidenceLabel(clip.confidence) })
            : t('stream.home.aiTitle')}
        </p>
      )}
    </section>
  );
}
