import { Fragment, useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, Heart, Play, Plus, Sparkles, X } from 'lucide-react';
import { t } from '../i18n';
import {
  confidenceLabel,
  formatDuration,
  formatSize,
  formatWhen,
  isNew,
  providerLabel,
  titleSize,
} from './format';
import type { StreamClip } from './model';
import { Picture } from './Picture';
import { useReturnFocus } from './useReturnFocus';

export interface DetailDialogProps {
  /** Open while a clip is set. */
  clip: StreamClip | null;
  /** "More from <game>", see moreFromGame. */
  more: StreamClip[];
  now: number;
  onClose: () => void;
  onPlay: (id: string, startAt?: number) => void;
  onOpenClip: (id: string) => void;
  /** Missing for accounts that may not change clips; the heart is hidden then. */
  onToggleFavorite?: (id: string) => void;
  onAddToCollection?: (id: string) => void;
  onEditTags?: (id: string) => void;
  /** More actions after the round buttons, e.g. ClipMenu. */
  menu?: ReactNode;
}

export function DetailDialog({ clip, onClose, ...props }: DetailDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const clipId = clip?.id;
  const returnFocus = useReturnFocus(!!clip);

  // When switching via "More from …", the new clip starts at the top with focus on "Play".
  useEffect(() => {
    if (!clipId) return;
    overlayRef.current?.scrollTo({ top: 0 });
    playRef.current?.focus();
  }, [clipId]);

  return (
    <Dialog.Root
      open={!!clip}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay ref={overlayRef} className="stream stream-detail-overlay">
          {clip && (
            <Dialog.Content
              className="stream-detail"
              {...(clip.description ? {} : { 'aria-describedby': undefined })}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                playRef.current?.focus();
              }}
              onCloseAutoFocus={returnFocus}
            >
              <DetailBody key={clip.id} clip={clip} playRef={playRef} {...props} />
            </Dialog.Content>
          )}
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailBody({
  clip,
  more,
  now,
  playRef,
  onPlay,
  onOpenClip,
  onToggleFavorite,
  onAddToCollection,
  onEditTags,
  menu,
}: Omit<DetailDialogProps, 'onClose' | 'clip'> & {
  clip: StreamClip;
  playRef: RefObject<HTMLButtonElement | null>;
}) {
  const marksId = useId();
  const moreId = useId();
  const confidence = clip.confidence ? confidenceLabel(clip.confidence) : '';
  const meta = [
    { key: 'when', text: formatWhen(clip.recordedAt, now) },
    { key: 'duration', text: formatDuration(clip.duration) },
    { key: 'res', text: clip.resolution },
    { key: 'size', text: formatSize(clip.size) },
  ].filter((part) => part.text);
  return (
    <>
      <div className="stream-detail-hero">
        <Picture
          src={clip.thumbnail}
          className="stream-detail-img"
          sizes="(max-width: 1000px) 100vw, 960px"
          eager
        />
        <div className="stream-detail-shade" aria-hidden="true" />
        <Dialog.Close className="stream-detail-close" aria-label={t('common.close')}>
          <X size={20} strokeWidth={2.5} aria-hidden="true" />
        </Dialog.Close>
        <div className="stream-detail-lead">
          <p className="stream-eyebrow">{clip.game}</p>
          <Dialog.Title className="stream-detail-title" data-size={titleSize(clip.title)}>
            {clip.title}
          </Dialog.Title>
          <div className="stream-detail-actions">
            <button
              ref={playRef}
              type="button"
              className="stream-button stream-button--primary"
              onClick={() => onPlay(clip.id)}
            >
              <Play size={22} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              {t('stream.play')}
            </button>
            {onAddToCollection && (
              <button
                type="button"
                className="stream-round"
                aria-label={t('stream.detail.addToCollection')}
                title={t('stream.detail.addToCollection')}
                onClick={() => onAddToCollection(clip.id)}
              >
                <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
            {onToggleFavorite && (
              <button
                type="button"
                className="stream-round"
                aria-label={t('stream.favorite')}
                title={t('stream.favorite')}
                aria-pressed={clip.favorite}
                onClick={() => onToggleFavorite(clip.id)}
              >
                <Heart
                  size={20}
                  strokeWidth={2.2}
                  fill={clip.favorite ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
              </button>
            )}
            {clip.downloadUrl && (
              <a
                className="stream-round"
                href={clip.downloadUrl}
                download={clip.title}
                aria-label={t('stream.detail.download')}
                title={t('stream.detail.download')}
              >
                <Download size={20} strokeWidth={2.2} aria-hidden="true" />
              </a>
            )}
            {menu}
          </div>
        </div>
      </div>

      <div className="stream-detail-body">
        <div className="stream-detail-grid">
          <div className="stream-detail-main">
            <p className="stream-detail-meta">
              {isNew(clip.recordedAt, now) && (
                <span className="stream-detail-new">{t('stream.tile.new')}</span>
              )}
              {meta.map((part, index) => (
                <Fragment key={part.key}>
                  {index > 0 && (
                    <span className="stream-sep" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span className={part.key === 'res' ? 'stream-res' : undefined}>{part.text}</span>
                </Fragment>
              ))}
            </p>
            {clip.description && (
              <Dialog.Description className="stream-detail-description">
                {clip.description}
              </Dialog.Description>
            )}
            {(clip.tags.length > 0 || onEditTags) && (
              <ul className="stream-chips" aria-label={t('stream.tags')}>
                {clip.tags.map((tag) => (
                  <li key={tag} className="stream-chip">
                    {tag}
                  </li>
                ))}
                {onEditTags && (
                  <li>
                    <button
                      type="button"
                      className="stream-chip stream-chip--add"
                      onClick={() => onEditTags(clip.id)}
                    >
                      {clip.tags.length ? t('stream.menu.editTags') : t('stream.detail.addTag')}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
          <dl className="stream-facts">
            <dt>{t('stream.detail.game')}</dt>
            <dd>{clip.game}</dd>
            {clip.deviceName && (
              <>
                <dt>{t('stream.detail.recording')}</dt>
                <dd>{clip.deviceName}</dd>
              </>
            )}
            {clip.analyzing ? (
              <>
                <dt>{t('stream.detail.analysis')}</dt>
                <dd className="stream-facts-live">
                  <Sparkles size={15} aria-hidden="true" />
                  {t('stream.detail.running')}
                </dd>
              </>
            ) : (
              clip.provider && (
                <>
                  <dt>{t('stream.detail.analysis')}</dt>
                  <dd>{providerLabel(clip.provider)}</dd>
                </>
              )
            )}
            {confidence && (
              <>
                <dt>{t('stream.detail.confidence')}</dt>
                <dd className={`stream-confidence stream-confidence--${clip.confidence}`}>
                  {confidence[0].toUpperCase() + confidence.slice(1)}
                </dd>
              </>
            )}
          </dl>
        </div>

        {clip.highlights.length > 0 && (
          <section className="stream-marks" aria-labelledby={marksId}>
            <div className="stream-section-head">
              <h3 id={marksId}>{t('stream.detail.highlights')}</h3>
              <span>{t('stream.detail.fromAi')}</span>
            </div>
            <ul className="stream-marks-list">
              {clip.highlights.map((mark) => (
                <li key={`${mark.seconds}-${mark.title}`}>
                  <button
                    type="button"
                    className="stream-mark"
                    title={mark.description || undefined}
                    onClick={() => onPlay(clip.id, mark.seconds)}
                  >
                    <span className="stream-mark-time">{formatDuration(mark.seconds)}</span>
                    <span className="stream-mark-title">{mark.title}</span>
                    <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {more.length > 0 && (
          <section className="stream-more" aria-labelledby={moreId}>
            <h3 id={moreId}>{t('stream.detail.moreFrom', { game: clip.game })}</h3>
            <ul className="stream-more-grid">
              {more.map((other) => (
                <li key={other.id}>
                  <button
                    type="button"
                    className="stream-more-card"
                    onClick={() => onOpenClip(other.id)}
                  >
                    <span className="stream-more-media">
                      <Picture
                        src={other.thumbnail}
                        className="stream-more-img"
                        sizes="(max-width: 600px) 90vw, 300px"
                      />
                      <span className="stream-duration">{formatDuration(other.duration)}</span>
                    </span>
                    <span className="stream-more-text">
                      <span className="stream-more-title">{other.title}</span>
                      <span className="stream-more-meta">
                        {[formatWhen(other.recordedAt, now, false), other.tags[0]]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
