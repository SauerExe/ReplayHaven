import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AlertCircle, ExternalLink, PictureInPicture2, RotateCcw } from 'lucide-react';
import type { Clip } from '../domain/models';
import { useVault } from '../data/store';
import { canContinue, time } from '../data/repository';
import { t } from '../i18n';
import { bufferedEnd } from '../streaming/buffer';
export default function Player({
  clip,
  shared = false,
  seekTo,
}: {
  clip: Clip;
  shared?: boolean;
  seekTo?: { seconds: number; nonce: number };
}) {
  const { state, setState, patchClip, toast } = useVault();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [resume, setResume] = useState(() => {
    const p = state.progress[clip.id];
    return p && canContinue(p.seconds, p.duration) ? p.seconds : 0;
  });
  const [speed, setSpeed] = useState(state.preferences.speed);
  const [pip, setPip] = useState(false);
  /** Played and loaded share of the video in percent, for the strip below the video. */
  const [bar, setBar] = useState({ played: 0, buffered: 0 });
  /** Playback stalled while waiting for data. */
  const [waiting, setWaiting] = useState(false);
  const lastSave = useRef(0);
  useEffect(() => {
    const video = videoRef.current;
    if (seekTo && video && loaded) {
      video.currentTime = Math.min(seekTo.seconds, video.duration);
      void video.play().catch(() => {});
    }
  }, [seekTo, loaded]);
  useEffect(() => {
    setPip('pictureInPictureEnabled' in document && document.pictureInPictureEnabled);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip.videoSource) return;
    let cleanup: undefined | (() => void);
    let cancelled = false;
    setError('');
    setLoaded(false);
    const source = clip.videoSource;
    if (source.includes('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setError(t('pages.player.hlsUnsupported'));
            return;
          }
          const hls = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 30, startLevel: 0 });
          hls.loadSource(source);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setError(t('pages.player.streamUnavailable'));
          });
          cleanup = () => hls.destroy();
        })
        .catch(() => setError(t('pages.player.loadFailed')));
    } else video.src = source;
    return () => {
      cancelled = true;
      cleanup?.();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [clip.videoSource, clip.status, retry]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, loaded]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,button,a,[contenteditable="true"],[role="dialog"],[role="menu"],video',
        ) ||
        document.querySelector('[role="dialog"]') ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey
      )
        return;
      const video = videoRef.current;
      if (!video || !loaded) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (video.paused) void video.play().catch(() => {});
        else video.pause();
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        video.currentTime = Math.max(
          0,
          Math.min(video.duration, video.currentTime + (e.key === 'ArrowRight' ? 5 : -5)),
        );
      }
      if (e.key.toLowerCase() === 'm') video.muted = !video.muted;
      if (e.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void video.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [loaded]);
  function updateBar() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const played = Math.min(100, (video.currentTime / video.duration) * 100);
    const loaded = (bufferedEnd(video.buffered, video.currentTime) / video.duration) * 100;
    setBar({ played, buffered: Math.min(100, Math.max(played, loaded)) });
  }
  function save(force = false) {
    const video = videoRef.current;
    if (!video || shared || !Number.isFinite(video.duration) || video.duration <= 0) return;
    if (!force && Date.now() - lastSave.current < 3000) return;
    lastSave.current = Date.now();
    setState((s) => ({
      ...s,
      progress: {
        ...s.progress,
        [clip.id]: {
          seconds: video.currentTime,
          duration: video.duration,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  }
  if (!clip.videoSource || clip.status !== 'ready')
    return (
      <div className="player-unavailable">
        <AlertCircle size={36} />
        <h2>
          {clip.status === 'processing'
            ? t('pages.player.processing')
            : clip.status === 'error'
              ? t('pages.player.failed')
              : t('pages.player.noVideo')}
        </h2>
        <p>
          {clip.status === 'processing'
            ? t('pages.player.processingText')
            : t('pages.player.noVideoText')}
        </p>
      </div>
    );
  return (
    <div className="player-wrapper">
      <div className="video-stage">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={clip.thumbnail || undefined}
          aria-label={clip.title}
          onLoadedMetadata={() => {
            setLoaded(true);
            const video = videoRef.current;
            if (video && Number.isFinite(video.duration) && !shared)
              patchClip(clip.id, {
                duration: video.duration,
                resolution: video.videoHeight ? `${video.videoHeight}p` : clip.resolution,
              });
          }}
          onTimeUpdate={() => {
            updateBar();
            save();
          }}
          onProgress={updateBar}
          onLoadStart={() => {
            setBar({ played: 0, buffered: 0 });
            setWaiting(false);
          }}
          // 'waiting' fires when playback stalls for data; 'playing' or 'canplay' mean it moves on.
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onResize={() => {
            const height = videoRef.current?.videoHeight;
            if (height && !shared && clip.resolution !== `${height}p`)
              patchClip(clip.id, { resolution: `${height}p` });
          }}
          onPause={() => save(true)}
          onSeeked={() => {
            updateBar();
            save(true);
          }}
          onEnded={() => {
            setWaiting(false);
            save(true);
          }}
          onError={() => {
            if (videoRef.current?.getAttribute('src')) setError(t('pages.player.playbackFailed'));
          }}
        />
        {waiting && !error && (
          <div
            className="stream stream-player-spinner"
            role="status"
            data-testid="player-buffering"
          >
            <span className="stream-player-spinner-ring" aria-hidden="true" />
            <span className="stream-sr-only">{t('stream.player.buffering')}</span>
          </div>
        )}
        {error && (
          <div className="player-error" role="alert">
            <AlertCircle size={30} />
            <h3>{t('pages.player.errorTitle')}</h3>
            <p>{error}</p>
            <div className="button-row">
              <button className="button primary" onClick={() => setRetry((n) => n + 1)}>
                <RotateCcw size={16} />
                {t('common.retry')}
              </button>
              {clip.sourcePage && (
                <a
                  className="button secondary"
                  href={clip.sourcePage}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('pages.player.openOriginal')}
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          </div>
        )}
        {!error && resume > 0 && loaded && (
          <div className="resume-prompt">
            <span>{t('pages.player.resumeAt', { time: time(resume) })}</span>
            <button
              className="button primary"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = resume;
                  void videoRef.current.play().catch(() => {});
                }
                setResume(0);
              }}
            >
              {t('pages.player.resume')}
            </button>
            <button className="text-button" onClick={() => setResume(0)}>
              {t('pages.player.restart')}
            </button>
          </div>
        )}
      </div>
      {/* Display only: the native controls stay the seek bar, so no extra focus stop. */}
      <div
        className="stream player-buffer"
        aria-hidden="true"
        data-testid="seek-buffer"
        style={{ '--played': `${bar.played}%`, '--buffered': `${bar.buffered}%` } as CSSProperties}
      >
        <div className="stream-seek-track">
          <div className="stream-seek-buffer" />
          <div className="stream-seek-fill" />
        </div>
      </div>
      <div className="player-toolbar">
        <span className="player-quality">
          <span className="tiny-dot" />
          {clip.local
            ? t('pages.player.localRecording')
            : clip.server
              ? t('pages.player.yourRecording')
              : t('pages.player.officialVideo')}
          <span className="player-resolution">{clip.resolution}</span>
        </span>
        <div>
          <label className="speed-control">
            <span>{t('pages.player.speed')}</span>
            <select
              aria-label={t('pages.player.speedLabel')}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          {pip && (
            <button
              className="icon-button"
              disabled={!loaded}
              aria-label={t('pages.player.pip')}
              onClick={async () => {
                try {
                  if (document.pictureInPictureElement) await document.exitPictureInPicture();
                  else await videoRef.current?.requestPictureInPicture();
                } catch {
                  toast(t('pages.player.pipUnavailable'));
                }
              }}
            >
              <PictureInPicture2 size={19} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
