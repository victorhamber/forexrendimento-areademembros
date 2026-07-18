import React, { useState, useEffect } from 'react';
import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';
import './Showcase.css';
import { X, ShoppingCart } from 'lucide-react';
import { slugify } from '../utils/slug';

interface ShowcaseCourse {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
}

interface ShowcaseProps {
  lang: Lang;
  onBack: () => void;
  slug?: string | null;
}

export const Showcase: React.FC<ShowcaseProps> = ({ lang, onBack, slug }) => {
  const tr = t(lang);
  const [items, setItems] = useState<ShowcaseCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ShowcaseCourse | null>(null);

  const activeSlug = (slug || '').trim().toLowerCase();
  const filteredItems = !activeSlug
    ? items
    : items.filter(c => slugify(c.slug) === activeSlug || slugify(c.title) === activeSlug);

  useEffect(() => {
    fetch('/api/public/courses')
      .then(res => res.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setItems(
            (data as { id?: string; title?: string; slug?: string; coverUrl?: string | null }[])
              .filter(c => c.title && c.slug)
              .map(c => ({
                id: String(c.id),
                title: String(c.title),
                slug: String(c.slug),
                description: null,
                coverUrl: c.coverUrl || null,
              }))
          );
        }
      })
      .catch(err => console.error('Failed to fetch showcase:', err))
      .finally(() => setLoading(false));
  }, []);

  const cover = (c: ShowcaseCourse) => c.coverUrl || '/brand-logo.png?v=3';

  return (
    <div className="showcase-container">
      <header className="showcase-header">
        <img src="/brand-logo.png?v=3" alt="Forex Rendimento" className="showcase-logo" />
        {!activeSlug && (
          <button className="showcase-back-btn" onClick={onBack}>
            {tr.showcase_back_btn}
          </button>
        )}
      </header>

      <div className="showcase-title-section">
        <h1 className="showcase-title">{tr.showcase_title}</h1>
        <p className="showcase-subtitle">{tr.showcase_description}</p>
      </div>

      {loading ? (
        <div className="showcase-grid">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="skeleton-card" style={{ width: '100%', height: '300px' }}>
              <div className="skeleton-cover" style={{ width: '100%', height: '80%' }}></div>
              <div className="skeleton-text" style={{ width: '60%', height: '14px', marginTop: '12px' }}></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="showcase-grid">
          {filteredItems.map(item => (
            <div key={item.id} className="showcase-card" onClick={() => setSelected(item)}>
              <div className="showcase-card-cover">
                <img src={cover(item)} alt={item.title} loading="lazy" />
                <span className="showcase-card-badge">EAD</span>
              </div>
              <h3 className="showcase-card-title">{item.title}</h3>
              <p className="showcase-card-author">AutoFinTech</p>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="showcase-modal-overlay" onClick={() => setSelected(null)}>
          <div className="showcase-modal-content" onClick={e => e.stopPropagation()}>
            <button className="showcase-modal-close" onClick={() => setSelected(null)} aria-label="Fechar" title="Fechar">
              <X size={20} />
            </button>

            <div className="showcase-modal-left">
              <img src={cover(selected)} alt={selected.title} className="showcase-modal-cover" />
            </div>

            <div className="showcase-modal-right">
              <span className="showcase-modal-tag">Trilha EAD</span>
              <h2 className="showcase-modal-title">{selected.title}</h2>
              <p className="showcase-card-author">AutoFinTech</p>

              <div className="showcase-modal-description">{tr.showcase_description}</div>

              <a href="/" className="showcase-buy-btn" onClick={() => setSelected(null)}>
                <ShoppingCart size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                {tr.showcase_back_btn}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
