export type VideoInfo = {
  provider: 'youtube' | 'vimeo' | 'html5' | 'unknown';
  videoId: string;
  embedUrl: string;
};

function yt(id: string): VideoInfo {
  return { provider: 'youtube', videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
}
function vim(id: string): VideoInfo {
  return { provider: 'vimeo', videoId: id, embedUrl: `https://player.vimeo.com/video/${id}` };
}
function html5(src: string): VideoInfo {
  return { provider: 'html5', videoId: src, embedUrl: src };
}

const HTML5_VIDEO_EXT = /\.(mp4|webm|ogg|ogv|m3u8)(\?|#|$)/i;

function isSelfHostedVideoUrl(url: string, parsed?: URL): boolean {
  const lower = url.toLowerCase();
  if (HTML5_VIDEO_EXT.test(lower)) return true;
  if (lower.includes('/api/public/media/') && lower.includes('/file')) return true;
  if (lower.includes('/uploads/') && HTML5_VIDEO_EXT.test(lower)) return true;
  if (parsed) {
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/api/public/media/') && path.endsWith('/file')) return true;
  }
  return false;
}

export function guessVideoMimeType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('.webm')) return 'video/webm';
  if (u.includes('.ogg') || u.includes('.ogv')) return 'video/ogg';
  if (u.includes('.m3u8')) return 'application/x-mpegURL';
  return 'video/mp4';
}

/**
 * Extrai provider + videoId + embedUrl de qualquer link de vídeo.
 */
export function parseVideoUrl(raw: string | null | undefined): VideoInfo | null {
  const url = String(raw ?? '').trim();
  if (!url) return null;

  try {
    const parsed = new URL(url, 'https://example.invalid');
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0];
      if (id) return yt(id);
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
      if (parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.split('/')[2];
        if (id) return yt(id);
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/')[2];
        if (id) return yt(id);
      }
      const v = parsed.searchParams.get('v');
      if (v) return yt(v);
    }

    if (host === 'vimeo.com') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0];
      if (id && /^\d+$/.test(id)) return vim(id);
    }
    if (host === 'player.vimeo.com') {
      const id = parsed.pathname.split('/').pop();
      if (id && /^\d+$/.test(id)) return vim(id);
      return { provider: 'vimeo', videoId: '', embedUrl: url };
    }

    if (isSelfHostedVideoUrl(url, parsed)) return html5(url);
  } catch {
    /* fallback */
  }

  const ytWatch = url.match(/(?:youtube\.com\/watch\?.*[&?]v=|youtu\.be\/)([\w-]{11})/i);
  if (ytWatch) return yt(ytWatch[1]);

  const ytShorts = url.match(/youtube\.com\/shorts\/([\w-]{11})/i);
  if (ytShorts) return yt(ytShorts[1]);

  const vimeo = url.match(/vimeo\.com\/(\d+)/i);
  if (vimeo) return vim(vimeo[1]);

  if (isSelfHostedVideoUrl(url)) return html5(url);

  return { provider: 'unknown', videoId: '', embedUrl: url };
}

/** URLs de poster do YouTube (maior → menor resolução) */
export function youtubePosterCandidates(videoId: string): string[] {
  return [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];
}

/** Carrega a melhor thumbnail disponível (padrão Presto Player) */
export function loadBestPoster(candidates: string[], minWidth = 121): Promise<string | null> {
  const tryOne = (src: string) =>
    new Promise<string>((resolve, reject) => {
      const img = new Image();
      const done = () => {
        img.onload = null;
        img.onerror = null;
        if (img.naturalWidth >= minWidth) resolve(src);
        else reject();
      };
      img.onload = done;
      img.onerror = () => reject();
      img.src = src;
    });

  return candidates.reduce<Promise<string | null>>(
    (chain, src) => chain.catch(() => tryOne(src)),
    Promise.reject()
  ).catch(() => null);
}

/** Atalho legado — retorna só a embedUrl */
export function toVideoEmbedUrl(raw: string | null | undefined): string | null {
  const info = parseVideoUrl(raw);
  return info?.embedUrl ?? null;
}
