import React from 'react';
import { Bookmark, GraduationCap, Lock } from 'lucide-react';
import './BookCard.css';

import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';

interface BookCardProps {
  id: string;
  title: string;
  author: string;
  description?: string;
  coverUrl: string;
  hasAccess?: boolean;
  isWishlisted?: boolean;
  salesUrl?: string;
  isBonus?: boolean;
  /** Card de trilha EAD na home: sem wishlist, badge próprio, capa opcional. */
  isCourse?: boolean;
  hideInfo?: boolean;
  hideAccessBadge?: boolean;
  lang?: Lang;
  onClick: (e: React.MouseEvent, id: string, hasAccess: boolean) => void;
  onToggleWishlist?: (id: string) => void;
}

export const BookCard: React.FC<BookCardProps> = ({ 
  id, 
  title, 
  author, 
  description,
  coverUrl, 
  hasAccess = false, 
  isWishlisted = false,
  salesUrl,
  isBonus = false,
  isCourse = false,
  hideInfo = false,
  hideAccessBadge = false,
  lang = 'pt',
  onClick,
  onToggleWishlist
}) => {
  const isHotmart = !isCourse && !hasAccess && salesUrl && salesUrl.includes('pay.hotmart.com');
  const tr = t(lang);
  const showCover = Boolean(coverUrl && coverUrl.trim());

  const locked = !hasAccess;

  const content = (
    <>
      <div className={`cover-container${locked ? ' cover-container--locked' : ''}`}>
        {showCover ? (
          <img
            src={coverUrl}
            alt={title}
            className="book-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className={`book-cover book-cover--placeholder${locked ? ' book-cover--placeholder-locked' : ''}`} aria-hidden>
            <GraduationCap size={48} strokeWidth={1.25} />
          </div>
        )}

        {hasAccess && !hideAccessBadge && (
          <div className="badge-access">
            {isCourse ? tr.badge_course : isBonus ? tr.badge_bonus : tr.badge_purchased}
          </div>
        )}

        {locked && (
          <div className="lock-overlay" aria-hidden>
            <span className="lock-overlay-badge">
              <Lock size={22} strokeWidth={2.25} />
            </span>
          </div>
        )}

        {/* Wishlist Button Overlay */}
        {!isCourse && (
          <button
            className="wishlist-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (onToggleWishlist) onToggleWishlist(id);
            }}
            aria-label={isWishlisted ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          >
            <Bookmark
              size={18}
              color={isWishlisted ? 'var(--accent-primary)' : '#fff'}
              fill={isWishlisted ? 'var(--accent-primary)' : 'transparent'}
              strokeWidth={1.5}
            />
          </button>
        )}
      </div>
      {!hideInfo && (
        <div className={`book-info${locked ? ' book-info--locked' : ''}`}>
          <h3 className="book-title">{title}</h3>
          {description ? (
            <p className="book-description">{description}</p>
          ) : (
            <p className="book-author">{author}</p>
          )}
        </div>
      )}
    </>
  );

  const cardClass = `book-card${locked ? ' book-card--locked' : ''}${isHotmart ? ' hotmart-fb' : ''}`;

  if (isHotmart) {
    return (
      <a href={salesUrl} className={cardClass} onClick={(e) => onClick(e, id, hasAccess)} style={{ textDecoration: 'none' }}>
        {content}
      </a>
    );
  }

  return (
    <div className={cardClass} onClick={(e) => onClick(e, id, hasAccess)}>
      {content}
    </div>
  );
};
