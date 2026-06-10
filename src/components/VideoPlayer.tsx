import { useCallback, useEffect, useRef, useState, memo } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { Play } from 'lucide-react';
import type { VideoInfo } from '../lib/videoEmbed';
import { guessVideoMimeType, loadBestPoster, youtubePosterCandidates } from '../lib/videoEmbed';
import { percentFromTime } from '../lib/lessonProgress';

interface Props {
  video: VideoInfo;
  title?: string;
  /** Percentual salvo (0–100) para retomar a reprodução */
  initialPercent?: number;
  /** Esconde capa de pause (ex.: contagem para próxima aula) */
  hidePauseOverlay?: boolean;
  onProgress?: (percent: number) => void;
  onEnded?: () => void;
}

const PLYR_OPTS: Plyr.Options = {
  controls: [
    'play-large',
    'play',
    'progress',
    'current-time',
    'duration',
    'mute',
    'volume',
    'settings',
    'fullscreen',
  ],
  settings: ['quality', 'speed'],
  youtube: {
    noCookie: true,
    rel: 0,
    showinfo: 0,
    iv_load_policy: 3,
    modestbranding: 1,
    customControls: true,
  },
  vimeo: {
    byline: false,
    portrait: false,
    title: false,
    customControls: true,
  },
  hideControls: true,
  clickToPlay: true,
  keyboard: { focused: true, global: false },
  tooltips: { controls: false, seek: true },
  ratio: '16:9',
  muted: false,
  volume: 1,
};

type PlyrWithEmbed = Plyr & {
  embed?: { unMute?: () => void; setVolume?: (n: number) => void };
};

/** YouTube muta ao dar seek antes do primeiro play; restaura áudio após retomar. */
function ensurePlayerAudio(player: Plyr) {
  try {
    player.muted = false;
    if (!player.volume || player.volume === 0) player.volume = 1;
    const embed = (player as PlyrWithEmbed).embed;
    embed?.unMute?.();
    embed?.setVolume?.(100);
  } catch {
    /* ignore */
  }
}

const PROGRESS_SAVE_INTERVAL_MS = 8000;

/** Fim do vídeo — embeds (YouTube) costumam parar um pouco antes do duration reportado. */
function isPlaybackFinished(player: Plyr): boolean {
  if (player.ended) return true;
  const duration = player.duration;
  const current = player.currentTime;
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return false;
  const remaining = duration - current;
  if (remaining <= 0.05) return true;
  const ratio = current / duration;
  if (ratio >= 0.985) return true;
  // Pausou nos últimos ~3s: trata como fim (YouTube raramente dispara 'ended')
  if (player.paused && remaining <= 3) return true;
  return false;
}

function handleNaturalPlaybackEnd(
  player: Plyr,
  setPauseCover: (v: boolean) => void,
  firePlaybackEnded: () => void
) {
  setPauseCover(false);
  if (isPlaybackFinished(player)) {
    firePlaybackEnded();
  }
}

export const VideoPlayer = memo(function VideoPlayer({
  video,
  title,
  initialPercent = 0,
  hidePauseOverlay = false,
  onProgress,
  onEnded,
}: Props) {
  const [activated, setActivated] = useState(false);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [pauseCover, setPauseCover] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const hasPlayedRef = useRef(false);
  const endedFiredRef = useRef(false);
  const lastSavedPercentRef = useRef(0);
  const initialResumePercentRef = useRef(0);
  const [resumePercentDisplay, setResumePercentDisplay] = useState(0);
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onProgressRef.current = onProgress;
    onEndedRef.current = onEnded;
  }, [onProgress, onEnded]);

  const useFacade = video.provider === 'youtube' || video.provider === 'vimeo' || video.provider === 'html5';
  const hideYoutubeUi = video.provider === 'youtube';
  const isHtml5 = video.provider === 'html5';

  useEffect(() => {
    endedFiredRef.current = false;
    const bounded = Math.min(100, Math.max(0, Math.round(initialPercent)));
    initialResumePercentRef.current = bounded;
    setResumePercentDisplay(bounded);
    lastSavedPercentRef.current = bounded;
  }, [video.videoId, video.provider, video.embedUrl, initialPercent]);

  useEffect(() => {
    if (video.provider !== 'youtube' || !video.videoId) {
      setPosterUrl(null);
      return;
    }
    let cancelled = false;
    loadBestPoster(youtubePosterCandidates(video.videoId)).then((url) => {
      if (!cancelled) setPosterUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [video.provider, video.videoId]);

  const firePlaybackEnded = useCallback(() => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    setPauseCover(false);
    lastSavedPercentRef.current = 100;
    onProgressRef.current?.(100);
    onEndedRef.current?.();
  }, []);

  const reportProgress = useCallback(
    (player: Plyr, force = false) => {
      const duration = player.duration;
      const current = player.currentTime;
      if (!duration || duration <= 0) return;
      const pct = percentFromTime(current, duration);
      if (!force && pct <= lastSavedPercentRef.current && !isPlaybackFinished(player)) return;
      lastSavedPercentRef.current = Math.max(lastSavedPercentRef.current, pct);
      onProgressRef.current?.(pct);

      // Fallback: alguns embeds (YouTube) não disparam 'ended' — só no último instante
      if (!endedFiredRef.current && isPlaybackFinished(player)) {
        firePlaybackEnded();
      }
    },
    [firePlaybackEnded]
  );

  const seekToSavedPosition = useCallback(
    (player: Plyr) => {
      const resumePercent = initialResumePercentRef.current;
      if (resumePercent <= 2) return;
      const duration = player.duration;
      if (!duration || duration <= 0) return;
      const target = (resumePercent / 100) * duration;
      if (target > 1) player.currentTime = target;
    },
    []
  );

  const wirePlyrEvents = useCallback(
    (player: Plyr) => {
      const onPause = () => {
        if (!hasPlayedRef.current) return;
        reportProgress(player, true);
        if (isPlaybackFinished(player)) {
          handleNaturalPlaybackEnd(player, setPauseCover, firePlaybackEnded);
        } else {
          setPauseCover(true);
        }
      };
      const onPlay = () => {
        hasPlayedRef.current = true;
        setPauseCover(false);
        ensurePlayerAudio(player);
      };
      const onPlaying = () => ensurePlayerAudio(player);
      const onTimeUpdate = () => reportProgress(player);
      const onEndedEvent = () => {
        handleNaturalPlaybackEnd(player, setPauseCover, firePlaybackEnded);
      };

      player.on('ready', () => {
        if (posterUrl) player.poster = posterUrl;
        ensurePlayerAudio(player);
        setPauseCover(false);

        const resumePercent = initialResumePercentRef.current;
        const startPlayback = () => {
          void Promise.resolve(player.play()).then(() => {
            ensurePlayerAudio(player);
            window.setTimeout(() => ensurePlayerAudio(player), 150);
            window.setTimeout(() => ensurePlayerAudio(player), 600);
          });
        };

        if (resumePercent > 2) {
          const onFirstPlaying = () => {
            player.off('playing', onFirstPlaying);
            seekToSavedPosition(player);
            ensurePlayerAudio(player);
            window.setTimeout(() => ensurePlayerAudio(player), 200);
          };
          player.on('playing', onFirstPlaying);
          startPlayback();
        } else {
          startPlayback();
        }
      });
      player.on('pause', onPause);
      player.on('play', onPlay);
      player.on('playing', onPlaying);
      player.on('timeupdate', onTimeUpdate);
      player.on('ended', onEndedEvent);

      const progressInterval = window.setInterval(() => {
        if (player && !player.paused) reportProgress(player, true);
      }, PROGRESS_SAVE_INTERVAL_MS);

      return () => {
        window.clearInterval(progressInterval);
        reportProgress(player, true);
        player.off('pause', onPause);
        player.off('play', onPlay);
        player.off('playing', onPlaying);
        player.off('timeupdate', onTimeUpdate);
        player.off('ended', onEndedEvent);
      };
    },
    [posterUrl, reportProgress, seekToSavedPosition, firePlaybackEnded]
  );

  const mountEmbedPlyr = useCallback(() => {
    const el = containerRef.current;
    if (!el || video.provider === 'unknown' || video.provider === 'html5') return;

    el.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'plyr__video-embed';
    wrapper.setAttribute('data-plyr-provider', video.provider);
    wrapper.setAttribute('data-plyr-embed-id', video.videoId);
    el.appendChild(wrapper);

    const player = new Plyr(wrapper, PLYR_OPTS);
    playerRef.current = player;
    return wirePlyrEvents(player);
  }, [video.provider, video.videoId, wirePlyrEvents]);

  const mountHtml5Plyr = useCallback(() => {
    const el = containerRef.current;
    if (!el || video.provider !== 'html5') return;

    el.innerHTML = '';
    const videoEl = document.createElement('video');
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('preload', 'metadata');
    videoEl.className = 'video-player-html5-source';
    const source = document.createElement('source');
    source.src = video.embedUrl;
    source.type = guessVideoMimeType(video.embedUrl);
    videoEl.appendChild(source);
    el.appendChild(videoEl);

    const player = new Plyr(videoEl, PLYR_OPTS);
    playerRef.current = player;
    return wirePlyrEvents(player);
  }, [video.provider, video.embedUrl, wirePlyrEvents]);

  const mountPlyr = useCallback(() => {
    if (video.provider === 'html5') return mountHtml5Plyr();
    return mountEmbedPlyr();
  }, [video.provider, mountHtml5Plyr, mountEmbedPlyr]);

  useEffect(() => {
    if (!activated || !useFacade) return;
    const cleanup = mountPlyr();
    return () => {
      cleanup?.();
      playerRef.current?.destroy();
      playerRef.current = null;
      hasPlayedRef.current = false;
      setPauseCover(false);
    };
  }, [activated, useFacade, mountPlyr]);

  const resumeFromCover = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPauseCover(false);
    const player = playerRef.current;
    if (!player) return;
    void Promise.resolve(player.play()).then(() => {
      ensurePlayerAudio(player);
      window.setTimeout(() => ensurePlayerAudio(player), 150);
    });
  };

  const handleFacadeActivate = () => {
    setActivated(true);
  };

  if (video.provider === 'unknown') {
    return (
      <iframe
        src={video.embedUrl}
        title={title || 'Vídeo'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ width: '100%', aspectRatio: '16/9', border: 0, display: 'block' }}
      />
    );
  }

  if (!activated && useFacade) {
    return (
      <button
        type="button"
        className={`video-player-facade${isHtml5 ? ' video-player-facade--html5' : ''}`}
        onClick={handleFacadeActivate}
        aria-label={title ? `Reproduzir: ${title}` : 'Reproduzir vídeo'}
      >
        {posterUrl ? (
          <img className="video-player-facade__poster" src={posterUrl} alt="" decoding="async" />
        ) : (
          <span className="video-player-facade__placeholder" aria-hidden />
        )}
        {resumePercentDisplay > 2 && (
          <span className="video-player-facade__resume-hint">Continuar de {resumePercentDisplay}%</span>
        )}
        <span className="video-player-facade__play">
          <Play size={32} fill="currentColor" strokeWidth={0} />
        </span>
      </button>
    );
  }

  return (
    <div className={`video-player-wrap${hideYoutubeUi ? ' hide-youtube-ui' : ''}`}>
      <div ref={containerRef} className="video-player-plyr-mount" />
      {pauseCover && !hidePauseOverlay && (
        <button
          type="button"
          className="video-player-pause-cover"
          onClick={resumeFromCover}
          aria-label="Continuar reprodução"
        >
          {posterUrl ? (
            <img className="video-player-pause-cover__poster" src={posterUrl} alt="" />
          ) : (
            <span className="video-player-facade__placeholder" aria-hidden />
          )}
          <span className="video-player-facade__play">
            <Play size={32} fill="currentColor" strokeWidth={0} />
          </span>
        </button>
      )}
    </div>
  );
});
