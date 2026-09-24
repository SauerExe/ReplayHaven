import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { formatDuration } from './format';
import { SkipTen } from './icons';
import type { StreamClip } from './model';
import { useReturnFocus } from './useReturnFocus';

export interface PlayerOverlayProps {
  clip: StreamClip;
  /** Startposition in Sekunden, etwa aus „Weiterschauen“ oder einer Zeitmarke. */
  startAt?: number;
  nextClip?: StreamClip | null;
  playbackRate?: number;
  onClose: () => void;
  onNext?: (id: string) => void;
  /** Höchstens alle 5 Sekunden, außerdem bei Pause, Ende und Schließen. */
  onProgress?: (id: string, seconds: number, duration: number) => void;
  onMetadata?: (id: string, info: { duration: number; height: number }) => void;
}

const HIDE_CONTROLS_AFTER = 3000;
const SAVE_EVERY = 5000;
const SKIP = 10;

function unavailable(clip: StreamClip) {
  if (clip.status === 'processing')
    return {
      title: 'Clip wird verarbeitet',
      text: 'Der Clip steht nach der Verarbeitung zur Verfügung.',
    };
  if (clip.status === 'error')
    return {
      title: 'Clip nicht verfügbar',
      text: 'Dieser Clip konnte nicht verarbeitet werden.',
    };
  if (!clip.videoUrl)
    return {
      title: 'Keine Videodatei vorhanden',
      text: 'Zu diesem Clip gibt es noch keine Videodatei zum Abspielen.',
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
  // Radix hängt den Inhalt erst einen Durchlauf später ins Portal. Als Zustand statt Ref
  // löst das fertige Element den Lade-Effekt aus.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(startAt);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [muted, setMuted] = useState(false);
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
    blocked ?? (loadError ? { title: 'Das Video lässt sich nicht laden', text: loadError } : null);
  const controlsHidden = playing && idle && !overControls && !message;
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

  // Gleicher Weg wie im bisherigen Player: HLS über hls.js, wenn der Browser es nicht selbst kann.
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
            setLoadError(
              'Dieser Browser unterstützt den Videostream nicht. Verwende einen aktuellen Browser.',
            );
            return;
          }
          const hls = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 30, startLevel: 0 });
          hls.loadSource(source);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal)
              setLoadError(
                'Der Videostream ist gerade nicht erreichbar. Prüfe deine Verbindung und versuche es erneut.',
              );
          });
          destroy = () => hls.destroy();
        })
        .catch(() =>
          setLoadError('Der Videoplayer konnte nicht geladen werden. Versuche es erneut.'),
        );
    } else video.src = source;
    return () => {
      cancelled = true;
      // Beim Schließen zählt die letzte Position, auch wenn der 5-Sekunden-Takt noch nicht erreicht ist.
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

  // Steuerung blendet sich nach drei Sekunden ohne Bewegung aus; jede Eingabe startet die Frist neu.
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
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    wake();
    const key = event.key.toLowerCase();
    // Leertaste und Enter auf Schaltflächen lösen die Schaltfläche aus, nicht Play/Pause.
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
            // Fokus auf den Player selbst, damit Leertaste sofort pausiert statt „Zurück“ auszulösen.
            event.preventDefault();
            rootRef.current?.focus();
          }}
          onCloseAutoFocus={returnFocus}
          onKeyDown={onKeyDown}
          onPointerMove={wake}
          onPointerDown={wake}
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
              save(event.currentTarget, false);
            }}
            onPlay={() => setPlaying(true)}
            onPause={(event) => {
              setPlaying(false);
              save(event.currentTarget, true);
            }}
            onEnded={(event) => {
              setPlaying(false);
              save(event.currentTarget, true);
            }}
            onSeeked={(event) => save(event.currentTarget, false)}
            onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
            onError={(event) => {
              if (event.currentTarget.getAttribute('src'))
                setLoadError(
                  'Das Video kann nicht abgespielt werden. Prüfe das Format oder versuche es erneut.',
                );
            }}
          />
          <div className="stream-player-shade" aria-hidden="true" />

          <div className="stream-player-top stream-player-chrome">
            <button type="button" className="stream-player-back" onClick={onClose}>
              <ArrowLeft size={26} strokeWidth={2.2} aria-hidden="true" />
              Zurück
            </button>
          </div>

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
                  Erneut versuchen
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
                Zum nächsten Highlight
                <span className="stream-next-mark-detail">
                  {formatDuration(upcoming.seconds)} · {upcoming.title}
                </span>
                <SkipForward size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}

            <div className="stream-seek" style={{ '--played': `${played}%` } as CSSProperties}>
              <div className="stream-seek-track" aria-hidden="true">
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
                aria-label="Wiedergabeposition"
                aria-valuetext={`${formatDuration(time)} von ${formatDuration(duration)}`}
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
                aria-label={playing ? 'Pause' : 'Abspielen'}
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
                aria-label="10 Sekunden zurück"
                onClick={() => seekBy(-SKIP)}
              >
                <SkipTen />
              </button>
              <button
                type="button"
                className="stream-control"
                aria-label="10 Sekunden vor"
                onClick={() => seekBy(SKIP)}
              >
                <SkipTen forward />
              </button>
              <button
                type="button"
                className="stream-control"
                aria-label={muted ? 'Ton einschalten' : 'Stummschalten'}
                onClick={toggleMute}
              >
                {muted ? (
                  <VolumeX size={30} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Volume2 size={30} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
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
                  aria-label={`Nächster Clip: ${nextClip.title}`}
                  title={`Nächster Clip: ${nextClip.title}`}
                  onClick={() => onNext(nextClip.id)}
                >
                  <SkipForward size={28} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="stream-control"
                aria-label={fullscreen ? 'Vollbild beenden' : 'Vollbild'}
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
