import { useCallback, useEffect, useRef, useState } from 'react';
import { Bold, ClipboardCopy, Italic, Link2, Palette } from 'lucide-react';
import {
  MEMBER_TAB_LINK_OPTIONS,
  memberTabHref,
  type MemberTabLink,
} from '../lib/memberTabs';
import { buildLessonCopyBlockHtml, isLessonBodyHtml, plainTextToLessonHtml, sanitizeLessonBodyHtml } from '../lib/lessonBodyHtml';
import { copyTextToClipboard } from '../lib/copyToClipboard';
import './LessonRichTextEditor.css';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
};

const TEXT_COLORS = ['#ffffff', '#fbbf24', '#34d399', '#60a5fa', '#f87171', '#c084fc', '#fb923c'];

export function LessonRichTextEditor({ value, onChange, placeholder, minHeight = 160 }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkMode, setLinkMode] = useState<'menu' | 'url'>('menu');
  const [linkTab, setLinkTab] = useState<MemberTabLink>('downloads');
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkNewTab, setLinkNewTab] = useState(true);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyBlockText, setCopyBlockText] = useState('');
  const savedRange = useRef<Range | null>(null);

  const emitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = sanitizeLessonBodyHtml(el.innerHTML);
    onChange(html);
  }, [onChange]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = value.trim()
      ? isLessonBodyHtml(value)
        ? sanitizeLessonBodyHtml(value)
        : plainTextToLessonHtml(value)
      : '';
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  const saveSelection = useCallback(() => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    savedRange.current = range.cloneRange();
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', saveSelection);
    return () => document.removeEventListener('selectionchange', saveSelection);
  }, [saveSelection]);

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (!sel || !savedRange.current) return;
    sel.removeAllRanges();
    sel.addRange(savedRange.current);
  };

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(cmd, false, val);
    emitChange();
  };

  const wrapSelectionWithColor = (color: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    if (range.collapsed) return;

    const normalized = color.trim();
    if (!normalized) return;

    const span = document.createElement('span');
    span.style.color = normalized;

    try {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
      const after = document.createRange();
      after.selectNodeContents(span);
      after.collapse(false);
      sel.removeAllRanges();
      sel.addRange(after);
      savedRange.current = after.cloneRange();
    } catch {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, normalized);
      saveSelection();
    }
    emitChange();
  };

  const openLinkDialog = () => {
    saveSelection();
    const sel = window.getSelection();
    const selected = sel?.toString().trim() || '';
    setLinkText(selected || 'clique aqui');
    setLinkMode('menu');
    setLinkTab('downloads');
    setLinkUrl('https://');
    setLinkNewTab(true);
    setLinkOpen(true);
  };

  const insertLink = () => {
    editorRef.current?.focus();
    restoreSelection();
    const text = linkText.trim() || 'clique aqui';
    let href = linkUrl.trim();
    let dataTab = '';

    if (linkMode === 'menu') {
      href = memberTabHref(linkTab, linkNewTab);
      dataTab = linkTab;
    } else if (!/^https?:\/\//i.test(href)) {
      href = `https://${href}`;
    }

    const target = linkNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
    const dataAttr = dataTab ? ` data-member-tab="${dataTab}"` : '';
    const html = `<a href="${href.replace(/"/g, '&quot;')}"${dataAttr}${target}>${text.replace(/</g, '&lt;')}</a>`;
    document.execCommand('insertHTML', false, html);
    setLinkOpen(false);
    emitChange();
  };

  const applyColor = (color: string) => {
    wrapSelectionWithColor(color);
  };

  const openCopyDialog = () => {
    saveSelection();
    setCopyBlockText('');
    setCopyOpen(true);
    setLinkOpen(false);
  };

  const insertCopyBlock = () => {
    const html = buildLessonCopyBlockHtml(copyBlockText);
    if (!html) return;
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    setCopyOpen(false);
    setCopyBlockText('');
    emitChange();
  };

  const handleEditorClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    const block = (e.target as HTMLElement).closest('.lesson-copy-block');
    if (!block) return;
    const text = block.getAttribute('data-copy') || '';
    if (!text) return;
    e.preventDefault();
    const ok = await copyTextToClipboard(text);
    const copyBtn = block.querySelector('[data-copy-btn]') as HTMLButtonElement | null;
    if (copyBtn) {
      const prev = copyBtn.textContent;
      copyBtn.textContent = ok ? 'Copiado!' : 'Erro';
      window.setTimeout(() => {
        copyBtn.textContent = prev || 'Copiar';
      }, 2000);
    }
  };

  return (
    <div className="lesson-rte">
      <div className="lesson-rte-toolbar" role="toolbar" aria-label="Formatação do texto da aula">
        <button type="button" className="lesson-rte-btn" title="Negrito" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <Bold size={16} />
        </button>
        <button type="button" className="lesson-rte-btn" title="Itálico" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <Italic size={16} />
        </button>
        <div className="lesson-rte-colors">
          <button
            type="button"
            className="lesson-rte-btn"
            title="Cor do texto selecionado"
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
            }}
            onClick={() => colorInputRef.current?.click()}
          >
            <Palette size={16} />
          </button>
          <input
            ref={colorInputRef}
            type="color"
            className="lesson-rte-color-input"
            defaultValue="#fbbf24"
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => applyColor(e.target.value)}
          />
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="lesson-rte-swatch"
              style={{ backgroundColor: c }}
              title={c}
              onMouseDown={(e) => {
                e.preventDefault();
                applyColor(c);
              }}
            />
          ))}
        </div>
        <button type="button" className="lesson-rte-btn lesson-rte-btn--link" title="Inserir link" onMouseDown={(e) => e.preventDefault()} onClick={openLinkDialog}>
          <Link2 size={16} />
          <span>Link / menu</span>
        </button>
        <button
          type="button"
          className="lesson-rte-btn lesson-rte-btn--link"
          title="Inserir texto copiável"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openCopyDialog}
        >
          <ClipboardCopy size={16} />
          <span>Texto copiável</span>
        </button>
      </div>

      <div
        ref={editorRef}
        className="lesson-rte-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder || 'Conteúdo da aula…'}
        style={{ minHeight }}
        onInput={emitChange}
        onBlur={emitChange}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        onClick={handleEditorClick}
      />

      {copyOpen && (
        <div className="lesson-rte-link-panel">
          <strong>Texto copiável</strong>
          <p className="lesson-rte-hint">
            O aluno verá um quadro com o texto e o botão <strong>Copiar</strong>. Clicar no texto ou no botão copia sem erro.
          </p>
          <label>Texto exato para copiar</label>
          <textarea
            rows={4}
            value={copyBlockText}
            onChange={(e) => setCopyBlockText(e.target.value)}
            placeholder="Ex: https://forexrendimento.com ou número da conta MT5"
          />
          <div className="lesson-rte-link-actions">
            <button type="button" className="btn-primary" onClick={insertCopyBlock}>
              Inserir
            </button>
            <button type="button" className="lesson-rte-btn-secondary" onClick={() => setCopyOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {linkOpen && (
        <div className="lesson-rte-link-panel">
          <strong>Inserir link</strong>
          <label>Texto do link</label>
          <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Ex: clique aqui" />
          <label>Tipo</label>
          <select value={linkMode} onChange={(e) => setLinkMode(e.target.value as 'menu' | 'url')}>
            <option value="menu">Menu da área de membros</option>
            <option value="url">URL externa</option>
          </select>
          {linkMode === 'menu' ? (
            <>
              <label>Menu de destino</label>
              <select value={linkTab} onChange={(e) => setLinkTab(e.target.value as MemberTabLink)}>
                {MEMBER_TAB_LINK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label>URL</label>
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
            </>
          )}
          <label className="lesson-rte-check">
            <input type="checkbox" checked={linkNewTab} onChange={(e) => setLinkNewTab(e.target.checked)} />
            Abrir em nova guia (recomendado — não interrompe o vídeo)
          </label>
          <div className="lesson-rte-link-actions">
            <button type="button" className="btn-primary" onClick={insertLink}>
              Inserir
            </button>
            <button type="button" className="lesson-rte-btn-secondary" onClick={() => setLinkOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
