import { useId } from 'react';
import { FolderPlus, Info, Layers, Play, Sparkles } from 'lucide-react';
import { countLabel, formatDuration } from './format';
import { linkHandler, type Navigate } from './links';
import { Picture } from './Picture';
import type { ClipTileData, CollectionTileData, GameTileData } from './rows';

const CLIP_SIZES = '(max-width: 600px) 168px, calc(11.54vw + 82px)';

export function ClipTile({
  item,
  variant,
  onOpen,
  onPlay,
}: {
  item: ClipTileData;
  variant: 'continue' | 'default';
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
}) {
  const { clip, meta, isNew, progress } = item;
  const descriptionId = useId();
  const status =
    clip.status === 'processing' ? 'Wird verarbeitet' : clip.status === 'error' ? 'Fehler' : '';
  const description = [
    meta,
    isNew && 'Neu',
    status,
    clip.analyzing && 'KI analysiert den Clip',
    !progress && formatDuration(clip.duration),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={`stream-tile stream-tile--clip stream-tile--${variant}`}>
      <button
        type="button"
        className="stream-tile-open"
        aria-label={clip.title}
        aria-describedby={descriptionId}
        onClick={() => onOpen(clip.id)}
      >
        <span className="stream-tile-media">
          <Picture src={clip.thumbnail} className="stream-tile-img" sizes={CLIP_SIZES} />
          {isNew && <span className="stream-badge">Neu</span>}
          {status && <span className="stream-badge stream-badge--status">{status}</span>}
          {progress ? (
            <span className="stream-progress">
              <span style={{ width: `${progress.percent}%` }} />
            </span>
          ) : (
            <span className="stream-duration">{formatDuration(clip.duration)}</span>
          )}
          {clip.analyzing && (
            <span className="stream-tile-analyzing">
              <Sparkles size={26} strokeWidth={2} aria-hidden="true" />
              KI analysiert den Clip …
            </span>
          )}
          <span className="stream-tile-reveal">
            {variant === 'default' && (
              <span className="stream-tile-info">
                <Info size={17} strokeWidth={2.2} aria-hidden="true" />
              </span>
            )}
          </span>
        </span>
        <span className="stream-tile-text">
          <span className="stream-tile-title">{clip.title}</span>
          <span className="stream-tile-meta">{meta}</span>
        </span>
        <span id={descriptionId} className="stream-sr-only">
          {description}
        </span>
      </button>
      {/* Nur für die Maus; per Tastatur und Touch führt „Abspielen“ im Detaildialog zum selben Ziel. */}
      <button
        type="button"
        className="stream-tile-play"
        tabIndex={-1}
        aria-label={`${clip.title} abspielen`}
        onClick={() => onPlay(clip.id)}
      >
        <Play size={variant === 'continue' ? 24 : 16} fill="currentColor" aria-hidden="true" />
      </button>
    </div>
  );
}

export function GameTile({ item, onNavigate }: { item: GameTileData; onNavigate?: Navigate }) {
  return (
    <a
      className="stream-tile stream-tile--game"
      href={item.href}
      onClick={linkHandler(onNavigate, item.href)}
    >
      <span className="stream-tile-media">
        <Picture
          src={item.cover}
          className="stream-tile-img"
          sizes="(max-width: 600px) 112px, 13vw"
        />
      </span>
      <span className="stream-tile-text">
        <span className="stream-tile-title">{item.name}</span>
        <span className="stream-tile-meta">{countLabel(item.count)}</span>
      </span>
    </a>
  );
}

export function ConnectFolderTile({ href, onNavigate }: { href: string; onNavigate?: Navigate }) {
  return (
    <a
      className="stream-tile stream-tile--connect"
      href={href}
      onClick={linkHandler(onNavigate, href)}
    >
      <span className="stream-tile-media">
        <FolderPlus size={28} strokeWidth={2} aria-hidden="true" />
        <span>
          Aufnahmeordner
          <br />
          verbinden
        </span>
      </span>
    </a>
  );
}

export function CollectionTile({
  item,
  onNavigate,
}: {
  item: CollectionTileData;
  onNavigate?: Navigate;
}) {
  const [first, ...rest] = item.thumbnails;
  return (
    <a
      className="stream-tile stream-tile--collection"
      href={item.href}
      onClick={linkHandler(onNavigate, item.href)}
    >
      <span className="stream-tile-media stream-mosaic" data-count={item.thumbnails.length}>
        {first ? (
          <>
            <Picture
              src={first}
              className="stream-mosaic-main"
              sizes="(max-width: 600px) 180px, 15vw"
            />
            {[0, 1].map((i) =>
              rest[i] ? (
                <Picture key={i} src={rest[i]} className="stream-mosaic-side" sizes="120px" />
              ) : (
                <span key={i} className="stream-mosaic-side stream-mosaic-empty" />
              ),
            )}
          </>
        ) : (
          <span className="stream-mosaic-none">
            <Layers size={30} strokeWidth={1.6} aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="stream-tile-text">
        <span className="stream-tile-title">{item.title}</span>
        <span className="stream-tile-meta">{item.meta ?? countLabel(item.count)}</span>
        {item.games && item.games.length > 0 && (
          <span className="stream-tile-games">
            <span className="stream-tile-covers" aria-hidden="true">
              {item.games.map((game) => (
                <Picture
                  key={game.key}
                  src={game.cover}
                  className="stream-tile-cover"
                  sizes="32px"
                />
              ))}
            </span>
            <span className="stream-tile-meta">
              {item.games.map((game) => game.name).join(', ')}
            </span>
          </span>
        )}
      </span>
    </a>
  );
}
