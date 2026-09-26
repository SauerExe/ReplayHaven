import { useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Folder,
  Heart,
  Play,
} from 'lucide-react';
import type { Clip, Collection } from '../domain/models';
import { games } from '../data/seed';
import { useVault } from '../data/store';
import { useCanEdit } from './AuthGate';
import { relativeDate, time } from '../data/repository';
import { ClipMenu } from './Actions';
import { Artwork } from './Artwork';
import { t, tp } from '../i18n';
export { Artwork } from './Artwork';
export function ClipCard({
  clip,
  selecting = false,
  selected = false,
  onSelect,
}: {
  clip: Clip;
  selecting?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { state, patchClip } = useVault();
  const editable = useCanEdit(clip);
  const game = games.find((g) => g.id === clip.gameId);
  const progress = state.progress[clip.id];
  const content = (
    <>
      <Artwork src={clip.thumbnail} />
      <span className="card-shade" />
      <span className="card-play">
        <Play size={22} fill="currentColor" />
      </span>
      <span className="duration">{time(clip.duration)}</span>
      {clip.status !== 'ready' && (
        <span className={`status-badge ${clip.status}`}>
          {clip.status === 'processing'
            ? t('app.cards.status.processing')
            : t('app.cards.status.error')}
        </span>
      )}
      {progress && progress.duration > 0 && (
        <span
          className="card-progress"
          style={{ width: `${Math.min(100, (progress.seconds / progress.duration) * 100)}%` }}
        />
      )}
      {selecting && (
        <span className={`select-indicator ${selected ? 'selected' : ''}`}>
          {selected && <Check size={17} />}
        </span>
      )}
    </>
  );
  return (
    <article className={`clip-card ${selected ? 'is-selected' : ''}`}>
      <div className="thumbnail">
        {selecting ? (
          <button
            className="thumbnail-link"
            onClick={onSelect}
            aria-label={t(selected ? 'app.cards.deselect' : 'app.cards.select', {
              title: clip.title,
            })}
            aria-pressed={selected}
          >
            {content}
          </button>
        ) : (
          <Link
            className="thumbnail-link"
            to={`/clips/${clip.id}`}
            aria-label={t('app.clip.play', { title: clip.title })}
          >
            {content}
          </Link>
        )}
        {!selecting && editable && (
          <button
            className={`card-favorite ${clip.favorite ? 'is-favorite' : ''}`}
            onClick={() => patchClip(clip.id, { favorite: !clip.favorite })}
            aria-label={t(clip.favorite ? 'app.cards.unfavorite' : 'app.cards.favorite', {
              title: clip.title,
            })}
            aria-pressed={clip.favorite}
          >
            <Heart size={15} fill={clip.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="card-caption">
        <div>
          <Link to={`/clips/${clip.id}`} className="clip-title">
            {clip.title}
          </Link>
          <p>
            <span className="game-dot" style={{ background: game?.color || '#a78bfa' }} />
            {game?.name || clip.gameName || t('app.clip.fallbackGame')}
            <span className="metadata-divider">·</span>
            {relativeDate(clip.recordedAt)}
          </p>
        </div>
        <ClipMenu clip={clip} />
      </div>
    </article>
  );
}
export function Section({
  title,
  subtitle,
  link,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  link?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [position, setPosition] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 2);
      setPosition({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener('scroll', update);
    update();
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [children]);
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="section-actions">
          {link && (
            <Link className="text-link" to={link}>
              {t('app.cards.showAll')} <ArrowRight size={15} />
            </Link>
          )}
          {overflow && (
            <div className="row-arrows">
              <button
                className="icon-button"
                disabled={!position.left}
                aria-label={t('app.cards.scrollBack', { title })}
                onClick={() =>
                  ref.current?.scrollBy({
                    left: -ref.current.clientWidth * 0.8,
                    behavior: 'smooth',
                  })
                }
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                disabled={!position.right}
                aria-label={t('app.cards.scrollForward', { title })}
                onClick={() =>
                  ref.current?.scrollBy({ left: ref.current.clientWidth * 0.8, behavior: 'smooth' })
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div ref={ref} className={scroll ? 'card-row' : 'section-content'}>
        {children}
      </div>
    </section>
  );
}
export function CollectionCard({ collection }: { collection: Collection }) {
  const { state } = useVault();
  const clips = collection.clipIds
    .map((id) => state.clips.find((c) => c.id === id))
    .filter((c): c is Clip => !!c);
  return (
    <Link to={`/collections/${collection.id}`} className="collection-card">
      <div className="collection-mosaic">
        {clips.length ? (
          clips.slice(0, 3).map((c) => <Artwork key={c.id} src={c.thumbnail} />)
        ) : (
          <div className="empty-cover">
            <Folder size={38} />
          </div>
        )}
        <div className="collection-overlay">
          <span className="collection-icon">
            <Folder size={18} />
          </span>
          <div>
            <h3>{collection.title}</h3>
            <p>
              {tp('common.clips', clips.length)} <span>·</span> {relativeDate(collection.updatedAt)}
            </p>
          </div>
          <ArrowRight size={19} />
        </div>
      </div>
    </Link>
  );
}
export function EmptyState({
  title = t('app.cards.emptyTitle'),
  description = t('app.cards.emptyText'),
  children,
  icon: Icon = Film,
}: {
  title?: string;
  description?: string;
  children?: ReactNode;
  icon?: ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        <Icon size={32} strokeWidth={1.4} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
