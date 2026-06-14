import React, { useEffect, useState } from 'react';
import { Download as DownloadIcon, FileDown } from 'lucide-react';
import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';
import { memberFetch } from '../lib/memberSession';
import './Library.css';

interface LibraryProps {
  lang: Lang;
  authHeaders?: (json?: boolean) => Record<string, string>;
}

export const Library: React.FC<LibraryProps> = ({ lang, authHeaders }) => {
  const tr = t(lang);
  const [downloads, setDownloads] = useState<
    Array<{
      id: number;
      productName: string;
      systemId: string;
      description: string | null;
      downloadUrl: string | null;
      downloadFileName: string | null;
      downloadVersion: string | null;
    }>
  >([]);
  const [loadingDownloads, setLoadingDownloads] = useState(true);

  useEffect(() => {
    const h = authHeaders ? authHeaders() : (() => {
      const tok = localStorage.getItem('contentpro_token');
      const userId = localStorage.getItem('contentpro_userId');
      const headers: Record<string, string> = {};
      if (userId) headers['x-user-id'] = userId;
      if (tok) headers['Authorization'] = `Bearer ${tok}`;
      return headers;
    })();
    memberFetch('/api/me/downloads', { headers: h })
      .then(r => r.json())
      .then((d: unknown) => {
        const rows = (d as { downloads?: unknown }).downloads;
        if (Array.isArray(rows)) setDownloads(rows as typeof downloads);
        else setDownloads([]);
      })
      .catch(() => setDownloads([]))
      .finally(() => setLoadingDownloads(false));
  }, [authHeaders]);

  if (!loadingDownloads && downloads.length === 0) {
    return (
      <div className="library-page library-empty">
        <div className="empty-icon-wrapper">
          <DownloadIcon size={48} strokeWidth={1.2} />
        </div>
        <h2>{tr.downloads_empty_title}</h2>
        <p>{tr.downloads_empty_desc}</p>
      </div>
    );
  }

  return (
    <div className="library-page">
      <h1 className="library-title">{tr.downloads_title}</h1>
      <h2 className="library-section-title">{tr.downloads_section_entitled}</h2>

      {loadingDownloads ? (
        <div className="downloads-grid downloads-grid--loading" aria-busy="true" aria-label={tr.downloads_loading}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="download-card download-card--skeleton" aria-hidden />
          ))}
        </div>
      ) : (
        <div className="downloads-grid">
          {downloads.map((row) => (
            <article key={row.id} className="download-card">
              <div className="download-card-head">
                <strong className="download-title">{row.productName}</strong>
                {row.downloadVersion && <span className="download-badge">v{row.downloadVersion}</span>}
              </div>
              {row.description && <p className="download-desc">{row.description}</p>}
              <div className="download-meta">
                <span className="download-meta-item">{row.downloadFileName || 'Arquivo'}</span>
              </div>
              {row.downloadUrl ? (
                <a className="download-btn" href={row.downloadUrl} download target="_blank" rel="noopener noreferrer">
                  <FileDown size={18} /> Baixar
                </a>
              ) : (
                <button type="button" className="download-btn" disabled>
                  <FileDown size={18} /> Indisponível
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
