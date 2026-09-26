import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  CircleAlert,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { t } from '../i18n';
import { bufferedEnd } from './buffer';
import { formatDuration } from './format';
import { SkipTen } from './icons';
import type { StreamClip } from './model';
import { useReturnFocus } from './useReturnFocus';

export interface PlayerOverlayProps {
  clip: StreamClip;
  /** Start position in seconds, e.g. from "Continue watching" or a highlight. */
  startAt?: number;
  nextClip?: StreamClip | null;
  playbackRate?: number;
  onClose: () => void;
  onNext?: (id: string) => void;
  /** At most every 5 seconds, plus on pause, end and close. */
  onProgress?: (id: string, seconds: number, duration: number) => void;
  onMetadata?: (id: string, info: { duration: number; height: number }) => void;
}

const HIDE_CONTROLS_AFTER = 3000;
const SAVE_EVERY = 5000;
const SKIP = 10;

function unavailable(clip: StreamClip) {
  if (clip.status === 'processing')
    return {
      title: t('stream.player.processingTitle'),
      text: t('stream.player.processingText'),
    };
  if (clip.status === 'error')
    return {
      title: t('stream.player.errorTitle'),
      text: t('stream.player.errorText'),
    };
  if (!clip.videoUrl)
    return {
      title: t('stream.player.noFileTitle'),
      text: t('stream.player.noFileText'),
    };
  return null;
}

export function PlayerOverlay({
  clip,
  startAt = 0,
  nextClip,
  playbackRate = 1,
  onClose,
  onNext,
  onProgress,
  onMetadata,
}: PlayerOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Radix mounts the content into the portal one pass later. As state instead of a ref, the
  // finished element triggers the loading effect.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(startAt);
  const [mediaDuration, setMediaDuration] = useState(0);
  /** End of the loaded range around the playhead, in seconds. */
  const [buffered, setBuffered] = useState(0);
  /** Playback stalled while waiting for data. */
  const [waiting, setWaiting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  // Like Netflix: hovering with the mouse opens the slider, a click mutes. A tap on a touchscreen
  // opens it instead, otherwise it could not be reached.
  const volumePointer = useRef('mouse');
  const lastAudibleVolume = useRef(1);
  const volumePanelId = useId();
  const [fullscreen, setFullscreen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [idle, setIdle] = useState(false);
  const [activity, setActivity] = useState(0);
  const [overControls, setOverControls] = useState(false);
  const returnFocus = useReturnFocus(true);
  const lastWake = useRef(0);
  const lastSave = useRef(0);
  const callbacks = useRef({ onProgress, onMetadata });
  useLayoutEffect(() => {
    callbacks.current = { onProgress, onMetadata };
  });

  const duration = mediaDuration || clip.duration;
  const blocked = unavailable(clip);
  const message =
    blocked ?? (loadError ? { title: t('stream.player.loadErrorTitle'), text: loadError } : null);
  const controlsHidden = playing && idle && !overControls && !volumeOpen && !message;
  const silent = muted || volume === 0;
  const volumePercent = silent ? 0 : Math.round(volume * 100);
  const upcoming = clip.highlights.find((mark) => mark.seconds > time + 0.5);

  const save = useCallback(
    (video: HTMLVideoElement, force: boolean) => {
      const total = video.duration;
      if (!Number.isFinite(total) || total <= 0) return;
      if (!force && Date.now() - lastSave.current < SAVE_EVERY) return;
      lastSave.current = Date.now();
      callbacks.current.onProgress?.(clip.id, video.currentTime, total);
    },
    [clip.id],
  );

  // Same approach as the previous player: HLS through hls.js if the browser cannot play it itself.
  useEffect(() => {
    const source = clip.videoUrl;
    if (!video || !source || clip.status !== 'ready') return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    if (source.includes('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setLoadError(t('stream.player.hlsUnsupported'));
            return;
          }
          const hls = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 30, startLevel: 0 });
          hls.loadSource(source);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setLoadError(t('stream.player.streamUnavailable'));
          });
          destroy = () => hls.destroy();
        })
        .catch(() => setLoadError(t('stream.player.playerFailed')));
    } else video.src = source;
    return () => {
      cancelled = true;
      // On close the last position counts, even if the 5-second interval has not been reached.
      save(video, true);
      destroy?.();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [video, clip.videoUrl, clip.status, retry, save]);

  useEffect(() => {
    if (video) video.playbackRate = playbackRate;
  }, [video, playbackRate]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Controls hide after three seconds without movement; every input restarts the timer.
  useEffect(() => {
    const timer = window.setTimeout(() => setIdle(true), HIDE_CONTROLS_AFTER);
    return () => window.clearTimeout(timer);
  }, [activity]);

  const wake = useCallback(() => {
    setIdle(false);
    const now = Date.now();
    if (now - lastWake.current < 200) return;
    lastWake.current = now;
    setActivity((n) => n + 1);
  }, []);

  function toggle() {
    if (!video || message) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }

  function seekTo(seconds: number) {
    const target = Math.max(0, Math.min(duration || 0, seconds));
    if (video && video.readyState > 0) video.currentTime = target;
    setTime(target);
  }

  function seekBy(delta: number) {
    seekTo((video && video.readyState > 0 ? video.currentTime : time) + delta);
  }

  function toggleMute() {
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = lastAudibleVolume.current;
      video.muted = false;
    } else video.muted = true;
    setMuted(video.muted);
    setVolume(video.volume);
  }

  function changeVolume(percent: number) {
    if (!video) return;
    video.volume = percent / 100;
    video.muted = percent === 0;
    setVolume(video.volume);
    setMuted(video.muted);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    wake();
    // Arrow keys on a slider belong to the slider, not to the player's skip keys.
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'))
      return;
    const key = event.key.toLowerCase();
    // Space and Enter on buttons activate the button, not play/pause.
    if ((key === ' ' || key === 'enter') && (event.target as HTMLElement).closest('button, a'))
      return;
    if (key === ' ' || key === 'k') toggle();
    else if (key === 'arrowleft') seekBy(-SKIP);
    else if (key === 'arrowright') seekBy(SKIP);
    else if (key === 'm') toggleMute();
    else if (key === 'f') toggleFullscreen();
    else return;
    event.preventDefault();
  }

  const played = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const loaded = duration > 0 ? Math.min(100, Math.max(played, (buffered / duration) * 100)) : 0;

  function updateBuffered(video: HTMLVideoElement) {
    setBuffered(bufferedEnd(video.buffered, video.currentTime));
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="stream stream-player-backdrop" />
        <Dialog.Content
          ref={rootRef}
          className="stream stream-player"
          data-idle={controlsHidden}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focus the player itself so Space pauses right away instead of triggering "Back".
            event.preventDefault();
            rootRef.current?.focus();
          }}
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={(event) => {
            if (!volumeOpen) return;
            event.preventDefault();
            volumeButtonRef.current?.focus();
            setVolumeOpen(false);
          }}
          onKeyDown={onKeyDown}
          onPointerMove={wake}
          onPointerDown={(event) => {
            wake();
            if (!volumeRef.current?.contains(event.target as Node)) setVolumeOpen(false);
          }}
        >
          <video
            ref={setVideo}
            className="stream-player-video"
            playsInline
            preload="metadata"
            poster={clip.thumbnail || undefined}
            onClick={toggle}
            onDoubleClick={toggleFullscreen}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              const total = Number.isFinite(video.duration) ? video.duration : 0;
              setMediaDuration(total);
              video.playbackRate = playbackRate;
              if (startAt > 0 && total)
                video.currentTime = Math.max(0, Math.min(startAt, total - 0.5));
              callbacks.current.onMetadata?.(clip.id, {
                duration: total,
                height: video.videoHeight,
              });
              void video.play().catch(() => setPlaying(false));
            }}
            onDurationChange={(event) => {
              const total = event.currentTarget.duration;
              if (Number.isFinite(total) && total > 0) setMediaDuration(total);
            }}
            onTimeUpdate={(event) => {
              setTime(event.currentTarget.currentTime);
              updateBuffered(event.currentTarget);
              save(event.currentTarget, false);
            }}
            onProgress={(event) => updateBuffered(event.currentTarget)}
            onLoadStart={() => {
              setBuffered(0);
              setWaiting(false);
            }}
            // 'waiting' fires when playback stalls for data; 'playing' or 'canplay' mean it moves on.
            onWaiting={() => setWaiting(true)}
            onPlaying={() => setWaiting(false)}
            onCanPlay={() => setWaiting(false)}
            onPlay={() => setPlaying(true)}
            onPause={(event) => {
              setPlaying(false);
              save(event.currentTarget, true);
            }}
            onEnded={(event) => {
              setPlaying(false);
              setWaiting(false);
              save(event.currentTarget, true);
            }}
            onSeeked={(event) => {
              updateBuffered(event.currentTarget);
              save(event.currentTarget, false);
            }}
            onVolumeChange={(event) => {
              const video = event.currentTarget;
              setMuted(video.muted);
              setVolume(video.volume);
              if (video.volume > 0) lastAudibleVolume.current = video.volume;
            }}
            onError={(event) => {
              if (event.currentTarget.getAttribute('src'))
                setLoadError(t('stream.player.cannotPlay'));
            }}
          />
          <div className="stream-player-shade" aria-hidden="true" />

          <div className="stream-player-top stream-player-chrome">
            <button type="button" className="stream-player-back" onClick={onClose}>
              <ArrowLeft size={26} strokeWidth={2.2} aria-hidden="true" />
              {t('common.back')}
            </button>
          </div>

          {waiting && !message && (
            <div className="stream-player-spinner" role="status" data-testid="player-buffering">
              <span className="stream-player-spinner-ring" aria-hidden="true" />
              <span className="stream-sr-only">{t('stream.player.buffering')}</span>
            </div>
          )}

          {message && (
            <div className="stream-player-message" role="alert">
              <CircleAlert size={30} strokeWidth={2} aria-hidden="true" />
              <h3>{message.title}</h3>
              <p>{message.text}</p>
              {loadError && !blocked && (
                <button
                  type="button"
                  className="stream-button stream-button--primary stream-button--small"
                  onClick={() => {
                    setLoadError('');
                    setRetry((n) => n + 1);
                  }}
                >
                  <RotateCcw size={18} aria-hidden="true" />
                  {t('common.retry')}
                </button>
              )}
            </div>
          )}

          <div
            className="stream-player-bottom stream-player-chrome"
            onPointerEnter={() => setOverControls(true)}
            onPointerLeave={() => setOverControls(false)}
          >
            {upcoming && (
              <button
                type="button"
                className="stream-next-mark"
                onClick={() => seekTo(upcoming.seconds)}
              >
                {t('stream.player.nextHighlight')}
                <span className="stream-next-mark-detail">
                  {formatDuration(upcoming.seconds)} · {upcoming.title}
                </span>
                <SkipForward size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}

            <div
              className="stream-seek"
              style={{ '--played': `${played}%`, '--buffered': `${loaded}%` } as CSSProperties}
            >
              <div className="stream-seek-track" aria-hidden="true">
                <div className="stream-seek-buffer" data-testid="seek-buffer" />
                <div className="stream-seek-fill" />
                <div className="stream-seek-thumb" />
              </div>
              <input
                type="range"
                className="stream-seek-input"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(time, duration || 0)}
                disabled={!duration}
                aria-label={t('stream.player.position')}
                aria-valuetext={t('stream.player.positionValue', {
                  time: formatDuration(time),
                  duration: formatDuration(duration),
                })}
                onChange={(event) => seekTo(Number(event.target.value))}
              />
              {duration > 0 &&
                clip.highlights.map((mark) => {
                  const position = Math.min(100, (mark.seconds / duration) * 100);
                  return (
                    <button
                      key={`${mark.seconds}-${mark.title}`}
                      type="button"
                      className="stream-marker"
                      style={{ left: `${position}%` }}
                      data-edge={position < 12 ? 'start' : position > 88 ? 'end' : undefined}
                      aria-label={`${formatDuration(mark.seconds)}, ${mark.title}`}
                      onClick={() => seekTo(mark.seconds)}
                    >
                      <span className="stream-marker-tip" aria-hidden="true">
                        <span className="stream-marker-time">{formatDuration(mark.seconds)}</span>
                        {mark.title}
                      </span>
                    </button>
                  );
                })}
            </div>

            <div className="stream-player-bar">
              <button
                type="button"
                className="stream-control"
                aria-label={playing ? t('stream.player.pause') : t('stream.play')}
                onClick={toggle}
              >
                {playing ? (
                  <Pause size={34} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                ) : (
                  <Play size={34} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="stream-control"
                aria-label={t('stream.player.back10')}
                onClick={() => seekBy(-SKIP)}
              >
                <SkipTen />
              </button>
              <button
                type="button"
                className="stream-control"
                aria-label={t('stream.player.forward10')}
                onClick={() => seekBy(SKIP)}
              >
                <SkipTen forward />
              </button>
              <div
                ref={volumeRef}
                className="stream-volume"
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') setVolumeOpen(true);
                }}
                onPointerLeave={(event) => {
                  // A mouse click on the icon does not keep the slider open, only keyboard focus does.
                  if (
                    event.pointerType === 'mouse' &&
                    !event.currentTarget.querySelector(':focus-visible')
                  )
                    setVolumeOpen(false);
                }}
                onFocusCapture={(event) => {
                  if (event.target.matches(':focus-visible')) setVolumeOpen(true);
                }}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setVolumeOpen(false);
                }}
              >
                <button
                  ref={volumeButtonRef}
                  type="button"
                  className="stream-control"
                  aria-label={silent ? t('stream.player.unmute') : t('stream.player.mute')}
                  aria-expanded={volumeOpen}
                  aria-controls={volumePanelId}
                  onPointerDown={(event) => (volumePointer.current = event.pointerType)}
                  onClick={(event) => {
                    // Keyboard (detail 0) and mouse mute; a tap opens the slider first.
                    if (event.detail > 0 && volumePointer.current !== 'mouse' && !volumeOpen)
                      setVolumeOpen(true);
                    else toggleMute();
                  }}
                >
                  {silent ? (
                    <VolumeX size={30} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Volume2 size={30} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
                {volumeOpen && (
                  <div id={volumePanelId} className="stream-volume-popover">
                    <div
                      className="stream-volume-panel"
                      role="group"
                      aria-label={t('stream.player.volume')}
                    >
                      <input
                        type="range"
                        className="stream-volume-input"
                        min={0}
                        max={100}
                        step={1}
                        value={volumePercent}
                        aria-label={t('stream.player.volume')}
                        aria-valuetext={t('stream.player.volumeValue', { percent: volumePercent })}
                        style={{ '--volume': `${volumePercent}%` } as CSSProperties}
                        onChange={(event) => changeVolume(Number(event.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>
              <span className="stream-player-time">
                {formatDuration(time)} / {formatDuration(duration)}
              </span>
              <div className="stream-player-heading">
                <Dialog.Title className="stream-player-title">{clip.title}</Dialog.Title>
                <span className="stream-player-game">{clip.game}</span>
              </div>
              {nextClip && onNext && (
                <button
                  type="button"
                  className="stream-control"
                  aria-label={t('stream.player.nextClip', { title: nextClip.title })}
                  title={t('stream.player.nextClip', { title: nextClip.title })}
                  onClick={() => onNext(nextClip.id)}
                >
                  <SkipForward size={28} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="stream-control"
                aria-label={
                  fullscreen ? t('stream.player.exitFullscreen') : t('stream.player.fullscreen')
                }
                onClick={toggleFullscreen}
              >
                {fullscreen ? (
                  <Minimize size={28} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Maximize size={28} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
