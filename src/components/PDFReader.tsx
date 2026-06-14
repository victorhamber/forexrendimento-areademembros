import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ArrowLeft, ChevronLeft, ChevronRight, Highlighter, Trash2, X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Mark from 'mark.js';
import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';
import { buildMemberAuthHeaders, memberFetch } from '../lib/memberSession';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './PDFReader.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function memberHeaders(userId: string, json = false): Record<string, string> {
  return buildMemberAuthHeaders(userId, json);
}

interface HighlightData {
  id: string;
  pageNumber: number;
  text: string;
  color: string;
}

interface PDFReaderProps {
  url: string;
  title: string;
  initialPage?: number;
  contentId: string;
  userId: string;
  lang: Lang;
  onClose: (lastPage?: number) => void;
}

const HIGHLIGHT_COLORS = [
  { name: 'Amarelo', value: 'yellow', bg: 'rgba(255, 235, 59, 0.4)' },
  { name: 'Verde', value: 'green', bg: 'rgba(102, 187, 106, 0.4)' },
  { name: 'Azul', value: 'blue', bg: 'rgba(66, 165, 245, 0.4)' },
  { name: 'Rosa', value: 'pink', bg: 'rgba(240, 98, 146, 0.4)' },
];

export const PDFReader: React.FC<PDFReaderProps> = ({ url, title, initialPage = 1, contentId, userId, lang, onClose }) => {
  const tr = t(lang);
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(initialPage);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(window.innerWidth - 32);

  const [highlights, setHighlights] = useState<HighlightData[]>([]);
  const [showHighlightPanel, setShowHighlightPanel] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  // PDF Loading Progress
  const [loadProgress, setLoadProgress] = useState<number>(0);

  // Highlight Lock Mode
  const [activeHighlightColor, setActiveHighlightColor] = useState<string | null>(null);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width - 32);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Fetch highlights from DB
  useEffect(() => {
    memberFetch(`/api/highlights/${contentId}`, { headers: memberHeaders(userId) })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setHighlights(data); })
      .catch(console.error);
  }, [contentId, userId]);

  // Apply highlights on the text layer after page renders
  const applyHighlightsToTextLayer = useCallback(() => {
    const pageHighlights = highlights.filter(h => h.pageNumber === pageNumber);

    const textLayer = document.querySelector('.react-pdf__Page__textContent') as HTMLElement;
    if (!textLayer) return;

    // Use Mark.js to intelligently highlight text across multiple spans
    const instance = new Mark(textLayer);
    instance.unmark({
      done: () => {
        if (pageHighlights.length === 0) return;
        pageHighlights.forEach(h => {
          instance.mark(h.text, {
            className: `mark-highlight-${h.color}`,
            acrossElements: true,
            separateWordSearch: false,
            accuracy: "partially"
          });
        });
      }
    });
  }, [highlights, pageNumber]);

  // Re-apply highlights when page changes or highlights update
  useEffect(() => {
    const timer = setTimeout(applyHighlightsToTextLayer, 300);
    return () => clearTimeout(timer);
  }, [applyHighlightsToTextLayer]);

  // Listen for text selection (only triggers save if in Highlight Mode)
  useEffect(() => {
    const handleSelection = async () => {
      // Small delay to ensure the browser has registered the selection correctly
      setTimeout(async () => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        
        if (text && text.length > 0 && activeHighlightColor) {
          // WE HAVE TEXT + WE ARE IN HIGHLIGHT MODE = Auto Save
          try {
            const res = await memberFetch('/api/highlights', {
              method: 'POST',
              headers: memberHeaders(userId, true),
              body: JSON.stringify({ contentId, pageNumber, text, color: activeHighlightColor })
            });
            const newHighlight = await res.json();
            setHighlights(prev => [...prev, newHighlight]);
            
            // Unlock screen
            setActiveHighlightColor(null);
            window.getSelection()?.removeAllRanges();
            
            // Re-apply after a short delay
            setTimeout(applyHighlightsToTextLayer, 200);
          } catch (err) { console.error(err); }
        }
      }, 100);
    };

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, [activeHighlightColor, contentId, pageNumber, userId, applyHighlightsToTextLayer]);

  // Deprecated manual save function
  const saveHighlight = async (color: string) => {
    setActiveHighlightColor(color);
    setShowColorPicker(false);
  };

  const deleteHighlight = async (id: string) => {
    try {
      await memberFetch(`/api/highlights/${id}`, {
        method: 'DELETE',
        headers: memberHeaders(userId)
      });
      setHighlights(prev => prev.filter(h => h.id !== id));
    } catch (err) { console.error(err); }
  };

  function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
    setNumPages(numPages);
  }

  const pageHighlightsCount = highlights.filter(h => h.pageNumber === pageNumber).length;

  return (
    <div className={`pdf-reader-container ${activeHighlightColor ? 'is-highlight-mode' : ''}`}>
      <header className="pdf-header">
        <button className="back-btn" onClick={() => onClose(pageNumber)}>
          <ArrowLeft size={24} />
        </button>
        <h2 className="pdf-title">{title}</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="back-btn" 
            onClick={() => {
              if (activeHighlightColor) {
                setActiveHighlightColor(null);
              } else {
                setShowColorPicker(!showColorPicker);
                setShowHighlightPanel(false);
              }
            }}
            style={{ color: activeHighlightColor ? 'var(--accent-primary)' : 'inherit' }}
          >
            <Highlighter size={20} />
          </button>

          <button 
            className="back-btn" 
            onClick={() => { setShowHighlightPanel(!showHighlightPanel); setShowColorPicker(false); }}
            style={{ position: 'relative' }}
          >
            <span style={{ fontSize: '18px' }}>📝</span>
            {highlights.length > 0 && (
              <span className="highlight-badge">{highlights.length}</span>
            )}
          </button>
        </div>
      </header>

      {/* Color Picker Toolbar */}
      {showColorPicker && !activeHighlightColor && (
        <div className="highlight-toolbar">
          <span className="highlight-toolbar-label">{tr.pdf_choose_color}</span>
          {HIGHLIGHT_COLORS.map(c => (
            <button 
              key={c.value} 
              className="color-btn" 
              style={{ backgroundColor: c.bg }}
              onClick={() => saveHighlight(c.value)}
              title={c.name}
            />
          ))}
          <button className="color-btn cancel-btn" onClick={() => setShowColorPicker(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Active Lock Mode Indicator */}
      {activeHighlightColor && (
        <div className="highlight-lock-banner">
          <span className="highlight-lock-dot" style={{ backgroundColor: HIGHLIGHT_COLORS.find(c => c.value === activeHighlightColor)?.bg }}></span>
          {tr.pdf_highlight_mode}
          <button className="highlight-lock-cancel" onClick={() => setActiveHighlightColor(null)}>{tr.pdf_highlight_cancel}</button>
        </div>
      )}

      {/* Highlights Panel */}
      {showHighlightPanel && (
        <div className="highlights-panel">
          <div className="highlights-panel-header">
            <h3>{tr.pdf_highlights_title} ({highlights.length})</h3>
            <button onClick={() => setShowHighlightPanel(false)}><X size={18} /></button>
          </div>
          {highlights.length === 0 ? (
            <p className="highlights-empty">{tr.pdf_highlights_empty}</p>
          ) : (
            <div className="highlights-list">
              {highlights.map(h => {
                const color = HIGHLIGHT_COLORS.find(c => c.value === h.color);
                return (
                  <div key={h.id} className="highlight-item">
                    <div className="highlight-color-bar" style={{ backgroundColor: color?.bg || '#ffeb3b' }} />
                    <div className="highlight-item-content">
                      <p className="highlight-text">"{h.text}"</p>
                      <span className="highlight-meta">{tr.pdf_highlight_page} {h.pageNumber}</span>
                    </div>
                    <button className="highlight-delete" onClick={() => deleteHighlight(h.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="pdf-content" ref={containerRef}>
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={4}
          centerOnInit={true}
          wheel={{ step: 0.1 }}
          disabled={!!activeHighlightColor}
          panning={{ disabled: !!activeHighlightColor }}
          pinch={{ disabled: !!activeHighlightColor }}
          doubleClick={{ disabled: !!activeHighlightColor }}
        >
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
            <Document 
              file={url} 
              onLoadSuccess={onDocumentLoadSuccess} 
              onLoadProgress={({ loaded, total }) => {
                if (total) setLoadProgress(Math.round((loaded / total) * 100));
              }}
              loading={
                <div className="pdf-loading-container">
                  <span className="pdf-progress-text">{tr.pdf_loading}</span>
                  <div className="pdf-progress-track">
                    <div className="pdf-progress-fill" style={{ width: `${loadProgress}%` }}></div>
                  </div>
                  <span style={{ fontSize: '13px' }}>{loadProgress}% {tr.pdf_complete}</span>
                </div>
              }
            >
              <Page 
                pageNumber={pageNumber} 
                width={Math.min(containerWidth, 800)} 
                renderTextLayer={true}
                renderAnnotationLayer={false}
                onRenderSuccess={applyHighlightsToTextLayer}
              />
            </Document>
          </TransformComponent>
        </TransformWrapper>
      </div>

      <div className="pdf-controls">
        <button 
          disabled={pageNumber <= 1} 
          onClick={() => setPageNumber(p => p - 1)}
          className="control-btn"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="page-indicator">
          {pageNumber} / {numPages || '--'}
          {pageHighlightsCount > 0 && <span className="page-highlights-count"> • {pageHighlightsCount} {tr.pdf_page_highlights}</span>}
        </span>
        <button 
          disabled={pageNumber >= (numPages || 1)} 
          onClick={() => setPageNumber(p => p + 1)}
          className="control-btn"
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
};
