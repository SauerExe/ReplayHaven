import { useId } from 'react';
import type { ReactNode } from 'react';
import { Check, Heart, Info, Play, Sparkles } from 'lucide-react';
import { canContinue } from '../data/repository';
import { formatDuration } from './format';
import type { StreamClip } from './model';
import { Picture } from './Picture';

const GRID_SIZES = '(max-width: 600px) 50vw, (max-width: 1100px) 34vw, 22vw';

export interface GridClipTileProps {
  clip: StreamClip;
  meta: string;
  isNew: boolean;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Auswahlmodus: ein Klick wählt aus, statt die Details zu öffnen. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Oben rechts neben dem Herz, etwa ClipMenu. */
  menu?: ReactNode;
  /** Unter Titel und Metadaten, etwa „Aus Sammlung entfernen“. */
  footer?: ReactNode;
}

/** Clip-Kachel für Raster wie Bibliothek und Sammlung; in Reihen der Startseite steht ClipTile. */
export function GridClipTile({
  clip,
  meta,
  isNew,
  onOpen,
  onPlay,
  onToggleFavorite,
  selecting = false,
  selected = false,
  onSelect,
  menu,
  footer,
}: GridClipTileProps) {
  const descriptionId = useId();
  const status =
    clip.status === 'processing' ? 'Wird verarbeitet' : clip.status === 'error' ? 'Fehler' : '';
  const progress =
    clip.progress && canContinue(clip.progress.seconds, clip.progress.duration)
      ? Math.min(100, (clip.progress.seconds / clip.progress.duration) * 100)
      : 0;
  const description = [
    meta,
    isNew && 'Neu',
    status,
    clip.analyzing && 'KI analysiert den Clip',
    formatDuration(clip.duration),
    clip.favorite && 'Favorit',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={`stream-tile stream-tile--clip stream-tile--grid${selected ? ' is-selected' : ''}`}
    >
      <button
        type="button"
        className="stream-tile-open"
        aria-label={selecting ? `${clip.title} ${selected ? 'abwählen' : 'auswählen'}` : clip.title}
        aria-pressed={selecting ? selected : undefined}
        aria-describedby={descriptionId}
        onClick={() => (selecting ? onSelect?.(clip.id) : onOpen(clip.id))}
      >
        <span className="stream-tile-media">
          <Picture src={clip.thumbnail} className="stream-tile-img" sizes={GRID_SIZES} />
          {(isNew || status) && (
            <span className="stream-tile-badges">
              {isNew && <span className="stream-badge">Neu</span>}
              {status && <span className="stream-badge stream-badge--status">{status}</span>}
            </span>
          )}
          <span className="stream-duration">{formatDuration(clip.duration)}</span>
          {progress > 0 && (
            <span className="stream-progress">
              <span style={{ width: `${progress}%` }} />
            </span>
          )}
          {clip.analyzing && (
            <span className="stream-tile-analyzing">
              <Sparkles size={26} strokeWidth={2} aria-hidden="true" />
              KI analysiert den Clip …
            </span>
          )}
          {selecting ? (
            <span className="stream-tile-check" data-selected={selected}>
              {selected && <Check size={18} strokeWidth={3} aria-hidden="true" />}
            </span>
          ) : (
            <span className="stream-tile-reveal">
              <span className="stream-tile-info">
                <Info size={17} strokeWidth={2.2} aria-hidden="true" />
              </span>
            </span>
          )}
        </span>
        <span className="stream-tile-text">
          <span className="stream-tile-title">{clip.title}</span>
          <span className="stream-tile-meta">{meta}</span>
        </span>
        <span id={descriptionId} className="stream-sr-only">
          {description}
        </span>
      </button>
      {!selecting && (
        <>
          {/* Nur für die Maus; per Tastatur führen Details und das Menü zum Abspielen. */}
          <button
            type="button"
            className="stream-tile-play"
            tabIndex={-1}
            aria-label={`${clip.title} abspielen`}
            onClick={() => onPlay(clip.id)}
          >
            <Play size={16} fill="currentColor" aria-hidden="true" />
          </button>
          <div className="stream-tile-tools">
            <button
              type="button"
              className="stream-tile-tool"
              data-active={clip.favorite}
              aria-label={
                clip.favorite
                  ? `${clip.title} aus Favoriten entfernen`
                  : `${clip.title} favorisieren`
              }
              title={clip.favorite ? 'Aus Favoriten entfernen' : 'Favorisieren'}
              onClick={() => onToggleFavorite(clip.id)}
            >
              <Heart
                size={17}
                strokeWidth={2.4}
                fill={clip.favorite ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </button>
            {menu}
          </div>
        </>
      )}
      {footer}
    </div>
  );
}
