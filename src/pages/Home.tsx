import React, { useState, useEffect, useMemo } from 'react';
import { BookRow } from '../components/BookRow';
import { Search } from 'lucide-react';
import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';
import { SHOW_LANGUAGE_SWITCHER } from '../i18n/featureFlags';
import { readCachedMemberHero, writeCachedMemberHero } from '../lib/memberHeroCache';
import { memberFetch } from '../lib/memberSession';
import './Home.css';

interface HomeProps {
  onOpenCourse?: (slug: string) => void;
  isLoading?: boolean;
  userEmail?: string | null;
  userName?: string | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  authHeaders?: (json?: boolean) => Record<string, string>;
}

type MemberHeroConfig = { backgroundUrl: string | null; kicker: string | null };

type PublicCourse = {
  id: string;
  title: string;
  slug: string;
  coverUrl?: string | null;
  modules?: { lessons?: unknown[] }[];
  isPublic?: boolean;
  hasAccess?: boolean;
  salesPageUrl?: string | null;
  memberPageUrl?: string | null;
  requiredSystemIds?: string[];
};

const COURSE_CARD_PREFIX = 'course:';

export const Home: React.FC<HomeProps> = ({
  onOpenCourse,
  isLoading,
  userEmail,
  userName,
  lang,
  setLang,
  authHeaders,
}) => {
  const tr = t(lang);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberHero, setMemberHero] = useState<MemberHeroConfig | null>(() => readCachedMemberHero());
  const [publishedCourses, setPublishedCourses] = useState<PublicCourse[]>([]);

  const courseRowItems = useMemo(() => {
    const trs = t(lang);
    return publishedCourses.map(c => {
      const modCount = c.modules?.length ?? 0;
      const lessonCount =
        c.modules?.reduce((acc, m) => acc + (Array.isArray(m.lessons) ? m.lessons.length : 0), 0) ?? 0;
      const cover = typeof c.coverUrl === 'string' && c.coverUrl.trim() ? c.coverUrl.trim() : '';
      const hasAccess = c.hasAccess !== false;
      return {
        id: `${COURSE_CARD_PREFIX}${c.slug}`,
        title: c.title,
        author: '',
        description: `${modCount} ${trs.courses_modules_count} · ${lessonCount} ${trs.courses_lessons_total}`,
        coverUrl: cover,
        hasAccess,
        salesUrl: c.salesPageUrl || undefined,
        isWishlisted: false,
        isBonus: false,
        isCourse: true,
        hideInfo: true,
        hideAccessBadge: true,
        language: lang,
      };
    });
  }, [publishedCourses, lang]);

  const unlockedCourseItems = useMemo(
    () => courseRowItems.filter((item) => item.hasAccess !== false),
    [courseRowItems]
  );

  const lockedCourseItems = useMemo(
    () => courseRowItems.filter((item) => item.hasAccess === false),
    [courseRowItems]
  );

  const lockedCourseItemsCompact = useMemo(
    () => lockedCourseItems.map((item) => ({ ...item, hideInfo: true })),
    [lockedCourseItems]
  );

  const handleBookClick = (id: string, hasAccess: boolean) => {
    if (!id.startsWith(COURSE_CARD_PREFIX)) return;
    const slug = id.slice(COURSE_CARD_PREFIX.length);
    if (!slug) return;
    if (hasAccess) {
      const course = publishedCourses.find(c => c.slug === slug);
      const memberUrl = course?.memberPageUrl?.trim();
      if (memberUrl) {
        window.location.href = memberUrl;
        return;
      }
      onOpenCourse?.(slug);
      return;
    }
    const course = publishedCourses.find(c => c.slug === slug);
    const url = course?.salesPageUrl;
    if (url) {
      window.location.href = url;
    } else {
      alert('Este curso é exclusivo para clientes da oferta. Você ainda não tem licença para acessá-lo.');
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    const name = userName || (userEmail ? userEmail.split('@')[0].charAt(0).toUpperCase() + userEmail.split('@')[0].slice(1) : '');
    if (hour < 12) return `${tr.greeting_morning}, ${name}!`;
    if (hour < 18) return `${tr.greeting_afternoon}, ${name}!`;
    return `${tr.greeting_evening}, ${name}!`;
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/member-hero')
      .then(r => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        if (cancelled || !d || typeof d !== 'object') return;
        const o = d as Record<string, unknown>;
        const backgroundUrl = typeof o.backgroundUrl === 'string' ? o.backgroundUrl : null;
        const kicker = typeof o.kicker === 'string' ? o.kicker : null;
        const next = { backgroundUrl, kicker };
        setMemberHero(next);
        writeCachedMemberHero(next);
      })
      .catch(() => {
        if (!cancelled) {
          const empty = { backgroundUrl: null, kicker: null };
          setMemberHero(empty);
          writeCachedMemberHero(empty);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders ? authHeaders() : undefined;
    memberFetch('/api/public/courses', headers ? { headers } : undefined)
      .then(r => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled) return;
        setPublishedCourses(Array.isArray(data) ? (data as PublicCourse[]) : []);
      })
      .catch(() => {
        if (!cancelled) setPublishedCourses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const q = searchQuery.trim().toLowerCase();
  const courseSearchMatches = q ? courseRowItems.filter(b => b.title.toLowerCase().includes(q)) : [];

  const searchResults = q !== '' ? courseSearchMatches : null;

  const heroFullbleedStyle: React.CSSProperties | undefined =
    memberHero?.backgroundUrl && memberHero.backgroundUrl.length > 0
      ? {
          backgroundImage: `url(${memberHero.backgroundUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }
      : undefined;

  const heroKickerText = (memberHero?.kicker && memberHero.kicker.trim()) || tr.hero_kicker;

  if (isLoading) {
    return (
      <div className="home-page home-page--fullbleed" style={{ paddingBottom: 'var(--spacing-lg)' }}>
        <div className="hero-fullbleed hero-fullbleed--netflix">
          <div className="hero-wrapper">
            <div className="hero-banner hero-skeleton hero-banner--netflix" aria-hidden />
          </div>
        </div>
        <div className="home-content">
          <div className="skeleton-row">
            <div className="skeleton-title"></div>
            <div className="skeleton-cards">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="skeleton-card">
                  <div className="skeleton-cover"></div>
                  <div className="skeleton-text"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home-page home-page--fullbleed" style={{ paddingBottom: 'var(--spacing-lg)' }}>
      <div className="hero-fullbleed hero-fullbleed--netflix" style={heroFullbleedStyle}>
        <div className="hero-wrapper">
          <div
            className="hero-banner hero-banner--netflix"
            role="region"
            aria-label={tr.hero_banner_aria}
          >
            <div className="hero-overlay" aria-hidden />
          </div>
        </div>

      </div>

      <div className="home-content">
        <div className="home-welcome">
          <p className="hero-kicker">{heroKickerText}</p>
          <h1 className="hero-greeting">{getGreeting()}</h1>
        </div>
        <div className="search-container search-container--row">
          <div className="search-field-wrap">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder={tr.search_placeholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          {SHOW_LANGUAGE_SWITCHER && (
            <div className="lang-switcher lang-switcher--toolbar" aria-label="Idioma">
              <button
                type="button"
                className={`lang-btn ${lang === 'pt' ? 'active' : ''}`}
                onClick={() => setLang('pt')}
                title="Português"
                aria-label="Português"
              >
                🇧🇷
              </button>
              <button
                type="button"
                className={`lang-btn ${lang === 'es' ? 'active' : ''}`}
                onClick={() => setLang('es')}
                title="Español"
                aria-label="Español"
              >
                🇪🇸
              </button>
            </div>
          )}
        </div>

        {searchResults !== null ? (
          searchResults.length > 0 ? (
            <BookRow
              title={`${tr.search_results_title} "${searchQuery}"`}
              books={searchResults}
              onBookClick={handleBookClick}
              onToggleWishlist={() => {}}
              lang={lang}
            />
          ) : (
            <div className="empty-search">
              <p>
                {tr.no_results} "<strong>{searchQuery}</strong>"
              </p>
            </div>
          )
        ) : courseRowItems.length > 0 ? (
          <>
            {unlockedCourseItems.length > 0 && (
              <BookRow
                title={tr.section_unlocked_access}
                books={unlockedCourseItems}
                onBookClick={handleBookClick}
                onToggleWishlist={() => {}}
                lang={lang}
              />
            )}
            {lockedCourseItems.length > 0 && (
              <BookRow
                title={tr.section_unlock_exclusive}
                books={lockedCourseItemsCompact}
                onBookClick={handleBookClick}
                onToggleWishlist={() => {}}
                lang={lang}
              />
            )}
          </>
        ) : (
          <div className="empty-search">
            <p>{tr.courses_empty}</p>
          </div>
        )}
      </div>
    </div>
  );
};
