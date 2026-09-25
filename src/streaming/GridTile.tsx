import { useId } from 'react';
import type { ReactNode } from 'react';
import { Check, Heart, Info, Play, Sparkles } from 'lucide-react';
import { canContinue } from '../data/repository';
import { t } from '../i18n';
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
  /** Missing for accounts that may not change clips; the heart is hidden then. */
  onToggleFavorite?: (id: string) => void;
  /** Selection mode: a click selects instead of opening the details. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Top right next to the heart, e.g. ClipMenu. */
  menu?: ReactNode;
  /** Below title and metadata, e.g. "Remove from collection". */
  footer?: ReactNode;
}

/** Clip tile for grids such as library and collection; home page rows use ClipTile. */
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
    clip.status === 'processing'
      ? t('stream.tile.processing')
      : clip.status === 'error'
        ? t('stream.tile.error')
        : '';
  const progress =
    clip.progress && canContinue(clip.progress.seconds, clip.progress.duration)
      ? Math.min(100, (clip.progress.seconds / clip.progress.duration) * 100)
      : 0;
  const description = [
    meta,
    isNew && t('stream.tile.new'),
    status,
    clip.analyzing && t('stream.tile.analyzing'),
    formatDuration(clip.duration),
    clip.favorite && t('stream.favorite'),
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
        aria-label={
          selecting
            ? t(selected ? 'stream.tile.deselect' : 'stream.tile.select', { title: clip.title })
            : clip.title
        }
        aria-pressed={selecting ? selected : undefined}
        aria-describedby={descriptionId}
        onClick={() => (selecting ? onSelect?.(clip.id) : onOpen(clip.id))}
      >
        <span className="stream-tile-media">
          <Picture src={clip.thumbnail} className="stream-tile-img" sizes={GRID_SIZES} />
          {(isNew || status) && (
            <span className="stream-tile-badges">
              {isNew && <span className="stream-badge">{t('stream.tile.new')}</span>}
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
              {t('stream.tile.analyzingLong')}
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
          {/* Mouse only; with the keyboard, details and the menu lead to playback. */}
          <button
            type="button"
            className="stream-tile-play"
            tabIndex={-1}
            aria-label={t('stream.tile.playTitle', { title: clip.title })}
            onClick={() => onPlay(clip.id)}
          >
            <Play size={16} fill="currentColor" aria-hidden="true" />
          </button>
          <div className="stream-tile-tools">
            {onToggleFavorite && (
              <button
                type="button"
                className="stream-tile-tool"
                data-active={clip.favorite}
                aria-label={
                  clip.favorite
                    ? t('stream.tile.unfavoriteTitle', { title: clip.title })
                    : t('stream.tile.favoriteTitle', { title: clip.title })
                }
                title={
                  clip.favorite ? t('stream.tile.unfavorite') : t('stream.tile.favoriteAction')
                }
                onClick={() => onToggleFavorite(clip.id)}
              >
                <Heart
                  size={17}
                  strokeWidth={2.4}
                  fill={clip.favorite ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
              </button>
            )}
            {menu}
          </div>
        </>
      )}
      {footer}
    </div>
  );
}
