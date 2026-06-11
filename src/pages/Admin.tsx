import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Pencil, Trash2, Users, KeyRound, UserPlus, Webhook, Copy, RefreshCw, Trash, Search, Mail, Key, GraduationCap, Layers, ListChecks, Images, Code2, LifeBuoy, Link2, FolderOpen, FolderPlus, Image as ImageIcon, Film, Music2, File as FileIcon } from 'lucide-react';
import { resolveProductForLicense } from '@shared/licenseProductMatch';
import {
  DEFAULT_RESET_BODY_PT,
  DEFAULT_WELCOME_BODY_PT,
  emailBodyFromStored,
} from '@shared/emailTemplates';
import { MEMBER_THEME_DEFAULTS, type MemberThemeKey } from '@shared/memberTheme';
import { LessonRichTextEditor } from '../components/LessonRichTextEditor';
import { sanitizeLessonBodyHtml } from '../lib/lessonBodyHtml';
import './Admin.css';

const MEMBER_THEME_COLOR_FIELDS: { key: MemberThemeKey; label: string }[] = [
  { key: 'member_theme_bg_main', label: 'Fundo principal' },
  { key: 'member_theme_bg_secondary', label: 'Fundo secundário' },
  { key: 'member_theme_bg_card', label: 'Fundo de cards' },
  { key: 'member_theme_text_primary', label: 'Texto principal' },
  { key: 'member_theme_text_secondary', label: 'Texto secundário' },
  { key: 'member_theme_accent_primary', label: 'Cor primária' },
  { key: 'member_theme_accent_primary_hover', label: 'Cor primária (hover)' },
  { key: 'member_theme_button_text', label: 'Cor da letra do botão' },
  { key: 'member_theme_video_accent', label: 'Cor do player de vídeo' },
];

function hexForColorInput(value: string | undefined, fallback: string): string {
  const v = String(value ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const [r, g, b] = v.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

const ADMIN_TABLE_PAGE_SIZE = 12;
const PLAN_OPTIONS = ['teste', 'mensal', 'semestral', 'anual', 'vitalicio'] as const;
const PAGE_BUILDER_PAGES_SETTING_KEY = 'admin_page_builder_pages_json';
const PAGE_BUILDER_FOLDERS_SETTING_KEY = 'admin_page_builder_folders_json';
const PAGE_BUILDER_LEGACY_SETTING_KEY = 'admin_page_builder_html';
type BuilderPageTarget = 'header' | 'body';
type BuilderFolder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};
type BuilderPage = {
  slug: string;
  target: BuilderPageTarget;
  html: string;
  updatedAt: string;
  published?: boolean;
  folderId?: string;
};
const DEFAULT_BUILDER_HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nova Página</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f8fb; color: #0f172a; }
      .hero { max-width: 900px; margin: 48px auto; background: #fff; border-radius: 16px; padding: 36px; box-shadow: 0 10px 25px rgba(2, 6, 23, 0.08); }
      .kicker { text-transform: uppercase; letter-spacing: 0.08em; font-size: 12px; color: #2563eb; font-weight: 700; }
      h1 { margin: 12px 0; font-size: 38px; line-height: 1.15; }
      p { color: #334155; line-height: 1.6; }
      .btn { display: inline-block; margin-top: 16px; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-weight: 700; }
    </style>
  </head>
  <body>
    <section class="hero">
      <span class="kicker">Oferta especial</span>
      <h1>Edite esta página clicando nos elementos</h1>
      <p>Use o editor visual para alterar textos e atributos sem sair do painel.</p>
      <a class="btn" href="#comprar">Quero comprar agora</a>
    </section>
  </body>
</html>`;

function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIsoOrNull(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function licenseStatusPillClass(status: string | null | undefined): string {
  const t = String(status || '').toLowerCase().trim();
  if (t === 'ativa' || t === 'inativa' || t === 'expirada') return t;
  return 'outro';
}

function effectiveLicenseStatus(status: string | null | undefined, dataExpiracao: string | Date | null | undefined): string {
  const raw = String(status || '').toLowerCase().trim();
  const exp = dataExpiracao ? new Date(dataExpiracao) : null;
  const expiredByDate = !!exp && !Number.isNaN(exp.getTime()) && exp.getTime() < Date.now();
  if (raw === 'ativa' && expiredByDate) return 'expirada';
  if (raw === 'ativa' || raw === 'inativa' || raw === 'expirada') return raw;
  return raw || 'outro';
}

function planDurationDays(planRaw: string | null | undefined): number {
  const plan = String(planRaw || 'mensal').toLowerCase().trim();
  const toleranceDays = 3;
  if (plan === 'teste') return 7 + toleranceDays;
  if (plan === 'semestral') return 180 + toleranceDays;
  if (plan === 'anual') return 365 + toleranceDays;
  if (plan === 'vitalicio') return 18250 + toleranceDays;
  return 30 + toleranceDays;
}

function planExpiryLocalValue(planRaw: string | null | undefined): string {
  const d = new Date();
  d.setDate(d.getDate() + planDurationDays(planRaw));
  return isoToDatetimeLocalValue(d.toISOString());
}

function compareLicenseStatusLabel(a: string, b: string): number {
  const rank = (s: string) => {
    const t = s.toLowerCase();
    if (t === 'ativa') return 0;
    if (t === 'inativa') return 1;
    if (t === 'expirada') return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, 'pt');
}

const ADMIN_JWT_KEY = 'contentpro_admin_jwt';
const ADMIN_UI_KEY = 'contentpro_admin_ui';

type AdminTab =
  | 'courses'
  | 'users'
  | 'webhooks'
  | 'email'
  | 'products'
  | 'forexEA'
  | 'banner'
  | 'builder'
  | 'support'
  | 'links'
  | 'media';

const ADMIN_TABS: AdminTab[] = [
  'courses',
  'users',
  'webhooks',
  'email',
  'products',
  'forexEA',
  'banner',
  'builder',
  'support',
  'links',
  'media',
];

type AdminUiState = {
  tab?: AdminTab;
  eadSectionTab?: 'curso' | 'modulo' | 'aula';
  selectedCourseId?: string;
  selectedModuleId?: string;
  selectedLessonId?: string;
};

function loadAdminUi(): AdminUiState {
  try {
    const raw = sessionStorage.getItem(ADMIN_UI_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AdminUiState;
  } catch {
    return {};
  }
}

function patchAdminUi(patch: Partial<AdminUiState>) {
  const next = { ...loadAdminUi(), ...patch };
  sessionStorage.setItem(ADMIN_UI_KEY, JSON.stringify(next));
}

function readStoredAdminTab(): AdminTab {
  const tab = loadAdminUi().tab;
  return tab && ADMIN_TABS.includes(tab) ? tab : 'courses';
}

function AdminPagination({
  page,
  totalItems,
  pageSize = ADMIN_TABLE_PAGE_SIZE,
  onChange,
}: {
  page: number;
  totalItems: number;
  pageSize?: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  if (totalItems <= pageSize) return null;
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, totalItems);
  return (
    <div className="admin-pagination" role="navigation" aria-label="Paginação da tabela">
      <span className="admin-pagination-info">
        {from}–{to} de {totalItems}
      </span>
      <div className="admin-pagination-buttons">
        <button type="button" className="admin-pagination-btn" onClick={() => onChange(1)} disabled={current <= 1} aria-label="Primeira página">
          «
        </button>
        <button type="button" className="admin-pagination-btn" onClick={() => onChange(current - 1)} disabled={current <= 1} aria-label="Página anterior">
          ‹
        </button>
        <span className="admin-pagination-page">
          {current} / {totalPages}
        </span>
        <button type="button" className="admin-pagination-btn" onClick={() => onChange(current + 1)} disabled={current >= totalPages} aria-label="Próxima página">
          ›
        </button>
        <button type="button" className="admin-pagination-btn" onClick={() => onChange(totalPages)} disabled={current >= totalPages} aria-label="Última página">
          »
        </button>
      </div>
    </div>
  );
}

export const Admin: React.FC = () => {
  const savedUi = useMemo(() => loadAdminUi(), []);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => !!localStorage.getItem(ADMIN_JWT_KEY));
  const [authBootstrapping, setAuthBootstrapping] = useState(() => !!localStorage.getItem(ADMIN_JWT_KEY));
  const [adminEmail, setAdminEmail] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [adminJwt, setAdminJwt] = useState(() => localStorage.getItem(ADMIN_JWT_KEY) || '');

  const authHeaders = (jwtOverride?: string): Record<string, string> => {
    const t = jwtOverride ?? adminJwt;
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const [activeTab, setActiveTabState] = useState<AdminTab>(readStoredAdminTab);
  const setActiveTab = (tab: AdminTab) => {
    setActiveTabState(tab);
    patchAdminUi({ tab });
  };

  const [users, setUsers] = useState<any[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  const [webhookUrls, setWebhookUrls] = useState<{
    appUrl: string;
    webhookBaseUrl: string;
    hotmartWebhook: string;
    forexWebhook: string;
    alternateHotmartWebhooks: string[];
  } | null>(null);

  // -- COURSES (EAD) STATE --
  const [courses, setCourses] = useState<any[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newCourseSlug, setNewCourseSlug] = useState('');
  const [newCourseCoverFile, setNewCourseCoverFile] = useState<File | null>(null);
  const [newCourseProductIds, setNewCourseProductIds] = useState('');
  const [newCourseSalesPageUrl, setNewCourseSalesPageUrl] = useState('');
  const [newCourseMemberPageUrl, setNewCourseMemberPageUrl] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>(savedUi.selectedCourseId || '');
  const [selectedModuleId, setSelectedModuleId] = useState<string>(savedUi.selectedModuleId || '');
  const [selectedLessonId, setSelectedLessonId] = useState<string>(savedUi.selectedLessonId || '');
  const [editCourseTitle, setEditCourseTitle] = useState('');
  const [editCourseSlug, setEditCourseSlug] = useState('');
  const [editCoursePublished, setEditCoursePublished] = useState(true);
  const [editCourseCoverFile, setEditCourseCoverFile] = useState<File | null>(null);
  const [editCourseProductIds, setEditCourseProductIds] = useState('');
  const [editCourseSalesPageUrl, setEditCourseSalesPageUrl] = useState('');
  const [editCourseMemberPageUrl, setEditCourseMemberPageUrl] = useState('');
  const [editModuleTitle, setEditModuleTitle] = useState('');
  const [editLessonTitle, setEditLessonTitle] = useState('');
  const [editLessonVideoUrl, setEditLessonVideoUrl] = useState('');
  const [editLessonBodyText, setEditLessonBodyText] = useState('');
  const [editLessonActionLabel, setEditLessonActionLabel] = useState('');
  const [editLessonActionUrl, setEditLessonActionUrl] = useState('');
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [newLessonVideoUrl, setNewLessonVideoUrl] = useState('');
  const [newLessonBodyText, setNewLessonBodyText] = useState('');
  const [newLessonActionLabel, setNewLessonActionLabel] = useState('');
  const [newLessonActionUrl, setNewLessonActionUrl] = useState('');
  const [draggedLessonId, setDraggedLessonId] = useState('');
  const [dragOverModuleId, setDragOverModuleId] = useState('');
  const [dragOverInsertIndex, setDragOverInsertIndex] = useState<number | null>(null);

  // -- USER FORM STATE --
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserProductId, setNewUserProductId] = useState('');
  const [newUserPlan, setNewUserPlan] = useState('mensal');
  const [managingAccessFor, setManagingAccessFor] = useState<any | null>(null);
  const [modalClientLicenses, setModalClientLicenses] = useState<any[]>([]);
  const [modalLicensesLoading, setModalLicensesLoading] = useState(false);
  const [licenseForm, setLicenseForm] = useState({
    systemId: '',
    plano: 'mensal',
    statusLicenca: 'ativa',
    dataExpiracao: planExpiryLocalValue('mensal'),
    numeroConta: '',
    offerCode: '',
  });
  const [editingLicenseId, setEditingLicenseId] = useState<number | null>(null);
  const [licenseModalBusy, setLicenseModalBusy] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userPlanFilter, setUserPlanFilter] = useState('todos');
  const [userStatusFilter, setUserStatusFilter] = useState('todos');
  const [userSort, setUserSort] = useState<'newest' | 'oldest'>('newest');
  const [pageUsers, setPageUsers] = useState(1);
  const [pageProducts, setPageProducts] = useState(1);
  const [pageWebhooks, setPageWebhooks] = useState(1);
  const [builderPages, setBuilderPages] = useState<BuilderPage[]>([]);
  const [builderFolders, setBuilderFolders] = useState<BuilderFolder[]>([]);
  const [builderSelectedFolderId, setBuilderSelectedFolderId] = useState<string | null>(null);
  const [newBuilderFolderName, setNewBuilderFolderName] = useState('');
  const [builderFolderSaving, setBuilderFolderSaving] = useState(false);
  const [builderLoadedOnce, setBuilderLoadedOnce] = useState(false);
  const [builderSaving, setBuilderSaving] = useState(false);
  const [builderStep, setBuilderStep] = useState<'list' | 'setup' | 'html'>('list');
  const [builderSetupSlug, setBuilderSetupSlug] = useState('');
  const [builderSetupTarget, setBuilderSetupTarget] = useState<BuilderPageTarget>('header');
  const [builderSetupHeadCode, setBuilderSetupHeadCode] = useState('');
  const [builderSetupBodyCode, setBuilderSetupBodyCode] = useState('');
  const [builderHeadCodeDraft, setBuilderHeadCodeDraft] = useState('');
  const [builderBodyCodeDraft, setBuilderBodyCodeDraft] = useState('');
  const [builderCurrentSlug, setBuilderCurrentSlug] = useState('');
  const [builderCodeDraft, setBuilderCodeDraft] = useState(DEFAULT_BUILDER_HTML);
  const [builderPreviewHtml, setBuilderPreviewHtml] = useState(DEFAULT_BUILDER_HTML);
  const [builderVisualOpen, setBuilderVisualOpen] = useState(false);
  const [builderPreviewMode, setBuilderPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [builderSelectedPath, setBuilderSelectedPath] = useState('');
  const [builderSelectedText, setBuilderSelectedText] = useState('');
  const [builderSelectedHref, setBuilderSelectedHref] = useState('');
  const [builderSelectedTextColor, setBuilderSelectedTextColor] = useState('#111111');
  const [builderSelectedBgColor, setBuilderSelectedBgColor] = useState('#ffffff');
  const [builderSelectedAlign, setBuilderSelectedAlign] = useState<'left' | 'center' | 'right'>('left');
  const [builderOffsetX, setBuilderOffsetX] = useState(0);
  const [builderOffsetY, setBuilderOffsetY] = useState(0);
  const builderIframeRef = useRef<HTMLIFrameElement | null>(null);
  const builderPagesRef = useRef<BuilderPage[]>([]);

  useEffect(() => {
    builderPagesRef.current = builderPages;
  }, [builderPages]);

  /** Abas internas do editor EAD (painel direito). */
  const [eadSectionTab, setEadSectionTabState] = useState<'curso' | 'modulo' | 'aula'>(
    savedUi.eadSectionTab === 'modulo' || savedUi.eadSectionTab === 'aula' ? savedUi.eadSectionTab : 'curso'
  );
  const setEadSectionTab = (tab: 'curso' | 'modulo' | 'aula') => {
    setEadSectionTabState(tab);
    patchAdminUi({ eadSectionTab: tab });
  };

  useEffect(() => {
    patchAdminUi({ selectedCourseId, selectedModuleId, selectedLessonId });
  }, [selectedCourseId, selectedModuleId, selectedLessonId]);
  const [eadLessonSubtab, setEadLessonSubtab] = useState<'nova' | 'editar'>('nova');

  // -- EMAIL SETTINGS STATE --
  const [emailSettings, setEmailSettings] = useState<Record<string, string>>({
    resend_api_key: '', sender_name: '', sender_email: '',
    welcome_template_pt: DEFAULT_WELCOME_BODY_PT,
    reset_template_pt: DEFAULT_RESET_BODY_PT,
    member_hero_background_url: '',
    member_hero_kicker: '',
    member_support_url: '',
    ...MEMBER_THEME_DEFAULTS,
  });
  const [licenses, setLicenses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [shortLinks, setShortLinks] = useState<any[]>([]);
  const [mediaAssets, setMediaAssets] = useState<any[]>([]);
  const [mediaFolders, setMediaFolders] = useState<any[]>([]);
  const [mediaFolderFilter, setMediaFolderFilter] = useState<'none' | string>('none');
  const [mediaUploadFolderId, setMediaUploadFolderId] = useState('');
  const [newMediaFolderName, setNewMediaFolderName] = useState('');
  const [mediaFolderSaving, setMediaFolderSaving] = useState(false);
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [editingShortLinkId, setEditingShortLinkId] = useState<number | null>(null);
  const emptyShortLinkForm = () => ({
    name: '',
    slug: '',
    targetUrl: '',
    redirectType: 301,
    utmParams: '',
    smartRules: '',
    isActive: true,
  });
  const [shortLinkForm, setShortLinkForm] = useState(emptyShortLinkForm);
  const [forexWebhook, setForexWebhook] = useState('');
  const [forexApiLines, setForexApiLines] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [bannerSaving, setBannerSaving] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const emptyProductForm = () => ({
    productName: '',
    systemId: '',
    offerCode: '',
    plano: 'mensal',
    description: '',
    downloadVersion: '',
  });
  const [newProduct, setNewProduct] = useState(emptyProductForm);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [selectedProductForDownload, setSelectedProductForDownload] = useState<any | null>(null);
  const [robotFile, setRobotFile] = useState<File | null>(null);

  const startEditProduct = (p: any) => {
    setEditingProductId(Number(p.id));
    setNewProduct({
      productName: String(p.productName || ''),
      systemId: String(p.systemId || ''),
      offerCode: String(p.offerCode || ''),
      plano: String(p.plano || 'mensal'),
      description: String(p.description || ''),
      downloadVersion: String(p.downloadVersion || ''),
    });
    setSelectedProductForDownload(null);
    setRobotFile(null);
  };

  const cancelEditProduct = () => {
    setEditingProductId(null);
    setNewProduct(emptyProductForm());
  };

  const startEditShortLink = (link: any) => {
    setEditingShortLinkId(Number(link.id));
    setShortLinkForm({
      name: String(link.name || ''),
      slug: String(link.slug || ''),
      targetUrl: String(link.targetUrl || ''),
      redirectType: Number(link.redirectType || 301),
      utmParams: String(link.utmParams || ''),
      smartRules: String(link.smartRules || ''),
      isActive: Boolean(link.isActive),
    });
  };

  const cancelEditShortLink = () => {
    setEditingShortLinkId(null);
    setShortLinkForm(emptyShortLinkForm());
  };

  const normalizeBuilderSlug = (raw: string) =>
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_/]+/g, '-')
      .replace(/\/+/g, '/')
      .replace(/(^[-/]+|[-/]+$)/g, '') || 'pagina-nova';

  const parseBuilderPagesSetting = (raw: string): BuilderPage[] => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((x) => x as Partial<BuilderPage>)
        .filter((x) => x && typeof x.slug === 'string' && typeof x.html === 'string')
        .map((x) => ({
          slug: normalizeBuilderSlug(String(x.slug)),
          html: String(x.html),
          target: x.target === 'header' ? 'header' : 'body',
          updatedAt: x.updatedAt ? String(x.updatedAt) : new Date().toISOString(),
          published: x.published === false ? false : true,
          folderId: typeof x.folderId === 'string' ? x.folderId : undefined,
        }));
    } catch {
      return [];
    }
  };

  const parseBuilderFoldersSetting = (raw: string): BuilderFolder[] => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((x) => x as Partial<BuilderFolder>)
        .filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
        .map((x) => ({
          id: String(x.id),
          name: String(x.name).trim() || 'Pasta',
          sortOrder: Number(x.sortOrder) || 0,
          createdAt: x.createdAt ? String(x.createdAt) : new Date().toISOString(),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  };

  const migrateBuilderFoldersAndPages = (
    pages: BuilderPage[],
    folders: BuilderFolder[]
  ): { pages: BuilderPage[]; folders: BuilderFolder[] } => {
    let nextFolders = [...folders];
    if (!nextFolders.length) {
      nextFolders = [{
        id: crypto.randomUUID(),
        name: 'Principal',
        sortOrder: 0,
        createdAt: new Date().toISOString(),
      }];
    }
    const validIds = new Set(nextFolders.map((f) => f.id));
    const fallbackId = nextFolders[0].id;
    const nextPages = pages.map((p) => ({
      ...p,
      folderId: p.folderId && validIds.has(p.folderId) ? p.folderId : fallbackId,
    }));
    return { pages: nextPages, folders: nextFolders };
  };

  const serializeBuilderPagesSetting = (pages: BuilderPage[]) => JSON.stringify(pages, null, 2);
  const serializeBuilderFoldersSetting = (folders: BuilderFolder[]) => JSON.stringify(folders, null, 2);

  const builderSelectedFolder = useMemo(
    () => builderFolders.find((f) => f.id === builderSelectedFolderId) || null,
    [builderFolders, builderSelectedFolderId]
  );

  const builderPagesInFolder = useMemo(() => {
    if (!builderSelectedFolderId) return [];
    return builderPages.filter((p) => p.folderId === builderSelectedFolderId);
  }, [builderPages, builderSelectedFolderId]);

  const persistBuilderState = async (
    pages: BuilderPage[],
    folders: BuilderFolder[],
    opts?: { skipLoadGuard?: boolean; allowShrink?: boolean }
  ) => {
    const h = authHeaders();
    if (!h.Authorization) return false;
    if (!opts?.skipLoadGuard && !builderLoadedOnce) {
      console.warn('[builder] Ignorando save: páginas ainda não carregaram do servidor.');
      return false;
    }
    try {
      const body: Record<string, unknown> = {
        [PAGE_BUILDER_PAGES_SETTING_KEY]: serializeBuilderPagesSetting(pages),
        [PAGE_BUILDER_FOLDERS_SETTING_KEY]: serializeBuilderFoldersSetting(folders),
      };
      if (opts?.allowShrink) body.__force_page_builder_shrink = true;
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      if (res.status === 409) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          saved?: number;
          previous?: number;
          snapshotKey?: string | null;
        };
        const msg =
          `Bloqueado pelo servidor: tentativa de sobrescrever ${j.previous} página(s) com apenas ${j.saved}.` +
          `\nBackup criado: ${j.snapshotKey || '(nenhum)'}.` +
          `\nRecarregue o admin e tente de novo. Para forçar mesmo assim, confirme abaixo.`;
        const force = window.confirm(`${msg}\n\nForçar gravação?`);
        if (!force) return false;
        return persistBuilderState(pages, folders, { ...opts, allowShrink: true });
      }
      const text = await res.text().catch(() => '');
      console.error('[builder] save falhou', res.status, text);
      return false;
    } catch (err) {
      console.error('[builder] save erro', err);
      return false;
    }
  };

  const getBuilderPreviewDocument = () => builderIframeRef.current?.contentDocument || null;

  const serializeBuilderDocument = () => {
    const doc = getBuilderPreviewDocument();
    if (!doc) return '';
    const cloned = doc.documentElement.cloneNode(true) as HTMLElement;
    cloned.querySelector('#admin-builder-selection-style')?.remove();
    cloned.querySelectorAll('.admin-builder-selected').forEach((el) => el.classList.remove('admin-builder-selected'));
    return `<!doctype html>\n${cloned.outerHTML}`;
  };

  const buildElementPath = (el: Element, doc: Document): string => {
    if (el === doc.body) return 'body';
    const segments: string[] = [];
    let current: Element | null = el;
    while (current && current !== doc.body) {
      const parentEl: Element | null = current.parentElement;
      if (!parentEl) break;
      const currentTag = current.tagName;
      const sameTagSiblings = (Array.from(parentEl.children) as Element[]).filter((s: Element) => s.tagName === currentTag);
      const idx = sameTagSiblings.indexOf(current) + 1;
      segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${idx})`);
      current = parentEl;
    }
    return segments.length ? `body > ${segments.join(' > ')}` : 'body';
  };

  const parsePxValue = (v: string | null | undefined) => {
    const n = parseInt(String(v || '').replace('px', '').trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const extractBuilderSelectedState = (el: Element | null) => {
    if (!el) {
      setBuilderSelectedText('');
      setBuilderSelectedHref('');
      setBuilderSelectedTextColor('#111111');
      setBuilderSelectedBgColor('#ffffff');
      setBuilderSelectedAlign('left');
      setBuilderOffsetX(0);
      setBuilderOffsetY(0);
      return;
    }
    const h = el as HTMLElement;
    const cs = window.getComputedStyle(h);
    setBuilderSelectedText(h.innerText || '');
    setBuilderSelectedHref(el.getAttribute('href') || '');
    setBuilderSelectedTextColor(cs.color || '#111111');
    setBuilderSelectedBgColor(cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#ffffff' : cs.backgroundColor || '#ffffff');
    const ta = (cs.textAlign || 'left').toLowerCase();
    setBuilderSelectedAlign(ta === 'center' ? 'center' : ta === 'right' ? 'right' : 'left');
    setBuilderOffsetX(parsePxValue(h.style.marginLeft));
    setBuilderOffsetY(parsePxValue(h.style.marginTop));
  };

  const selectBuilderElement = (path: string) => {
    const doc = getBuilderPreviewDocument();
    if (!doc || !path) return;
    doc.querySelectorAll('.admin-builder-selected').forEach((el) => el.classList.remove('admin-builder-selected'));
    const selected = doc.querySelector(path);
    if (!selected) return;
    selected.classList.add('admin-builder-selected');
    setBuilderSelectedPath(path);
    extractBuilderSelectedState(selected);
  };

  const applyBuilderVisualValues = (opts: {
    text?: string;
    href?: string;
    textColor?: string;
    bgColor?: string;
    align?: 'left' | 'center' | 'right';
    offsetX?: number;
    offsetY?: number;
  }) => {
    const doc = getBuilderPreviewDocument();
    if (!doc || !builderSelectedPath) return;
    const target = doc.querySelector(builderSelectedPath) as HTMLElement | null;
    if (!target) return;
    if (opts.text !== undefined) target.innerText = opts.text;
    if (opts.href !== undefined) target.setAttribute('href', opts.href);
    if (opts.textColor !== undefined) target.style.color = opts.textColor;
    if (opts.bgColor !== undefined) target.style.backgroundColor = opts.bgColor;
    if (opts.align !== undefined) target.style.textAlign = opts.align;
    if (opts.offsetX !== undefined) target.style.marginLeft = `${opts.offsetX}px`;
    if (opts.offsetY !== undefined) target.style.marginTop = `${opts.offsetY}px`;
    target.classList.add('admin-builder-selected');
    extractBuilderSelectedState(target);
    const serialized = serializeBuilderDocument();
    if (serialized) {
      const nextBody = getBuilderAreaCode(serialized, 'body');
      setBuilderBodyCodeDraft(nextBody);
      setBuilderCodeDraft((prev) => setBuilderHtmlSections(prev, { head: builderHeadCodeDraft, body: nextBody }));
    }
  };

  const handleBuilderIframeLoad = () => {
    const doc = getBuilderPreviewDocument();
    if (!doc) return;
    if (!doc.querySelector('#admin-builder-selection-style')) {
      const st = doc.createElement('style');
      st.id = 'admin-builder-selection-style';
      st.textContent = `.admin-builder-selected{outline:2px solid #3b82f6 !important; outline-offset:2px !important;}`;
      doc.head.appendChild(st);
    }
    doc.onclick = (ev) => {
      const target = ev.target as Element | null;
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();
      const path = buildElementPath(target, doc);
      selectBuilderElement(path);
    };
    if (builderSelectedPath) selectBuilderElement(builderSelectedPath);
  };

  const BUILDER_HEAD_INJECT_ATTR = 'data-af-head-inject';

  const normalizeFullHtmlPaste = (code: string): { body: string; headAppend: string } => {
    const trimmed = code.trim();
    if (!/<!doctype|<html[\s>]/i.test(trimmed)) {
      return { body: trimmed, headAppend: '' };
    }
    try {
      const doc = new DOMParser().parseFromString(trimmed, 'text/html');
      return {
        body: doc.body.innerHTML.trim(),
        headAppend: doc.head.innerHTML.trim(),
      };
    } catch {
      return { body: trimmed, headAppend: '' };
    }
  };

  const injectHtmlExtras = (html: string, headCode: string, bodyCode: string) => {
    let out = html || DEFAULT_BUILDER_HTML;
    const h = headCode.trim();
    const b = bodyCode.trim();
    if (h) out = out.includes('</head>') ? out.replace('</head>', `\n${h}\n</head>`) : `${h}\n${out}`;
    if (b) out = out.includes('</body>') ? out.replace('</body>', `\n${b}\n</body>`) : `${out}\n${b}`;
    return out;
  };

  const mergeHeadAppendFromPaste = (html: string, headAppend: string) => {
    if (!headAppend.trim()) return html;
    try {
      const doc = new DOMParser().parseFromString(html || DEFAULT_BUILDER_HTML, 'text/html');
      const tpl = doc.createElement('template');
      tpl.innerHTML = headAppend;
      Array.from(tpl.content.children).forEach((el) => {
        if (el.tagName === 'SCRIPT' && el.hasAttribute(BUILDER_HEAD_INJECT_ATTR)) return;
        doc.head.appendChild(el.cloneNode(true));
      });
      return `<!doctype html>\n${doc.documentElement.outerHTML}`;
    } catch {
      return html;
    }
  };

  const buildFinalBuilderHtml = (headCode: string, bodyCode: string, baseHtml?: string) => {
    const bodyNorm = normalizeFullHtmlPaste(bodyCode);
    let html = setBuilderHtmlSections(baseHtml || DEFAULT_BUILDER_HTML, { body: bodyNorm.body });
    if (bodyNorm.headAppend) {
      html = mergeHeadAppendFromPaste(html, bodyNorm.headAppend);
    }
    html = setBuilderHtmlSections(html, { head: headCode });
    return html.trim() || DEFAULT_BUILDER_HTML;
  };

  const getBuilderAreaCode = (html: string, target: BuilderPageTarget) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html || DEFAULT_BUILDER_HTML, 'text/html');
      if (target === 'body') return doc.body.innerHTML.trim();

      const injected = Array.from(doc.head.querySelectorAll(`[${BUILDER_HEAD_INJECT_ATTR}]`));
      if (injected.length) {
        return injected.map((el) => el.outerHTML).join('\n');
      }

      // Legado: scripts/links extras sem marcador
      const headClone = doc.head.cloneNode(true) as HTMLElement;
      headClone.querySelectorAll('meta[charset], meta[name="viewport"], title').forEach((el) => el.remove());
      headClone.querySelectorAll('style').forEach((styleEl) => {
        const css = (styleEl.textContent || '').replace(/\s+/g, ' ');
        if (css.includes('.hero { max-width: 900px') && css.includes('.kicker { text-transform: uppercase')) {
          styleEl.remove();
        }
      });
      return headClone.innerHTML.trim();
    } catch {
      return '';
    }
  };

  const getBuilderHtmlSections = (html: string) => ({
    head: getBuilderAreaCode(html, 'header'),
    body: getBuilderAreaCode(html, 'body'),
  });

  const setBuilderAreaCode = (html: string, target: BuilderPageTarget, code: string) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html || DEFAULT_BUILDER_HTML, 'text/html');
      if (target === 'header') {
        if (!doc.querySelector('meta[charset]')) {
          const metaCharset = doc.createElement('meta');
          metaCharset.setAttribute('charset', 'UTF-8');
          doc.head.prepend(metaCharset);
        }
        if (!doc.querySelector('meta[name="viewport"]')) {
          const metaViewport = doc.createElement('meta');
          metaViewport.setAttribute('name', 'viewport');
          metaViewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
          doc.head.appendChild(metaViewport);
        }
        doc.head.querySelectorAll(`[${BUILDER_HEAD_INJECT_ATTR}]`).forEach((el) => el.remove());
        const trimmed = code.trim();
        if (trimmed) {
          const tpl = doc.createElement('template');
          tpl.innerHTML = trimmed;
          Array.from(tpl.content.children).forEach((el) => {
            el.setAttribute(BUILDER_HEAD_INJECT_ATTR, '1');
            doc.head.appendChild(el);
          });
        }
      } else {
        const bodyNorm = normalizeFullHtmlPaste(code);
        doc.body.innerHTML = bodyNorm.body;
      }
      return `<!doctype html>\n${doc.documentElement.outerHTML}`;
    } catch {
      return html;
    }
  };

  const setBuilderHtmlSections = (html: string, sections: { head?: string; body?: string }) => {
    let next = html || DEFAULT_BUILDER_HTML;
    if (sections.head !== undefined) next = setBuilderAreaCode(next, 'header', sections.head);
    if (sections.body !== undefined) next = setBuilderAreaCode(next, 'body', sections.body);
    return next;
  };

  const toBuilderVisualPreviewHtml = (html: string) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html || DEFAULT_BUILDER_HTML, 'text/html');
      doc.querySelectorAll('script').forEach((el) => el.remove());
      return `<!doctype html>\n${doc.documentElement.outerHTML}`;
    } catch {
      return html || DEFAULT_BUILDER_HTML;
    }
  };

  const builderCurrentPage = useMemo(
    () => builderPages.find((p) => p.slug === builderCurrentSlug) || null,
    [builderPages, builderCurrentSlug]
  );

  const openBuilderPage = (slug: string) => {
    const page = builderPages.find((p) => p.slug === slug);
    if (!page) return;
    const sections = getBuilderHtmlSections(page.html || DEFAULT_BUILDER_HTML);
    setBuilderCurrentSlug(page.slug);
    setBuilderCodeDraft(page.html || DEFAULT_BUILDER_HTML);
    setBuilderPreviewHtml(toBuilderVisualPreviewHtml(page.html || DEFAULT_BUILDER_HTML));
    setBuilderHeadCodeDraft(sections.head);
    setBuilderBodyCodeDraft(sections.body);
    setBuilderSelectedPath('');
    setBuilderSelectedText('');
    setBuilderSelectedHref('');
    setBuilderSelectedAlign('left');
    setBuilderOffsetX(0);
    setBuilderOffsetY(0);
    setBuilderVisualOpen(false);
    setBuilderStep('html');
  };

  const updateBuilderCurrentTarget = (target: BuilderPageTarget) => {
    if (!builderCurrentSlug) return;
    setBuilderPages((prev) =>
      prev.map((p) => (p.slug === builderCurrentSlug ? { ...p, target, updatedAt: new Date().toISOString() } : p))
    );
  };

  const handleBuilderCreateContinue = () => {
    const slug = normalizeBuilderSlug(builderSetupSlug);
    const exists = builderPages.find((p) => p.slug === slug);
    if (exists) {
      openBuilderPage(exists.slug);
      return;
    }
    if (!builderSelectedFolderId) {
      alert('Selecione ou crie uma pasta antes de criar a página.');
      setBuilderStep('list');
      return;
    }
    const page: BuilderPage = {
      slug,
      target: builderSetupTarget,
      html: injectHtmlExtras(DEFAULT_BUILDER_HTML, builderSetupHeadCode, builderSetupBodyCode),
      updatedAt: new Date().toISOString(),
      published: false,
      folderId: builderSelectedFolderId,
    };
    const next = [page, ...builderPages];
    setBuilderPages(next);
    setBuilderCurrentSlug(page.slug);
    setBuilderCodeDraft(page.html);
    setBuilderPreviewHtml(toBuilderVisualPreviewHtml(page.html));
    setBuilderHeadCodeDraft(getBuilderAreaCode(page.html, 'header'));
    setBuilderBodyCodeDraft(getBuilderAreaCode(page.html, 'body'));
    setBuilderSetupSlug('');
    setBuilderSetupTarget('header');
    setBuilderSetupHeadCode('');
    setBuilderSetupBodyCode('');
    setBuilderStep('html');
  };

  const resolveBuilderHtmlForSave = () => {
    let headCode = builderHeadCodeDraft;
    let bodyCode = builderBodyCodeDraft;
    let baseHtml = builderCodeDraft || DEFAULT_BUILDER_HTML;
    if (builderVisualOpen) {
      const serialized = serializeBuilderDocument();
      if (serialized) {
        headCode = getBuilderAreaCode(serialized, 'header');
        bodyCode = getBuilderAreaCode(serialized, 'body');
        baseHtml = serialized;
      }
    }
    return buildFinalBuilderHtml(headCode, bodyCode, baseHtml);
  };

  const saveBuilderPages = async (opts?: { publish?: boolean; conclude?: boolean }) => {
    const h = authHeaders();
    if (!h.Authorization) return;
    if (!builderCurrentSlug) {
      alert('Crie ou selecione uma página antes de salvar.');
      return;
    }
    if (!builderLoadedOnce) {
      alert('Aguarde o carregamento das páginas antes de salvar (evita sobrescrever páginas existentes).');
      return;
    }
    setBuilderSaving(true);
    try {
      const html = resolveBuilderHtmlForSave();
      const slug = builderCurrentSlug;
      const folderId = builderSelectedFolderId || builderFolders[0]?.id;
      const currentPages = [...builderPagesRef.current];
      const nextPages = [...currentPages];
      const idx = nextPages.findIndex((p) => p.slug === slug);
      const wasPublished = idx >= 0 ? nextPages[idx].published !== false : true;
      const published = opts?.publish === true ? true : wasPublished;
      if (idx >= 0) {
        nextPages[idx] = {
          ...nextPages[idx],
          html,
          updatedAt: new Date().toISOString(),
          published,
        };
      } else {
        nextPages.unshift({
          slug,
          target: builderCurrentPage?.target || 'body',
          html,
          updatedAt: new Date().toISOString(),
          published,
          folderId,
        });
      }
      const ok = await persistBuilderState(nextPages, builderFolders);
      if (!ok) {
        alert('Falha ao salvar página.');
        return;
      }
      setBuilderPages(nextPages);
      setBuilderCodeDraft(html);
      setBuilderHeadCodeDraft(getBuilderAreaCode(html, 'header'));
      setBuilderBodyCodeDraft(getBuilderAreaCode(html, 'body'));
      setBuilderPreviewHtml(toBuilderVisualPreviewHtml(html));
      if (opts?.conclude) setBuilderStep('list');
      alert(opts?.publish ? 'Página salva e publicada! Scripts do HEAD rodam na URL pública.' : 'Rascunho salvo com sucesso.');
    } catch {
      alert('Erro de conexão ao salvar.');
    } finally {
      setBuilderSaving(false);
    }
  };

  const toggleBuilderPagePublished = async (slug: string, publish: boolean) => {
    const h = authHeaders();
    if (!h.Authorization) return;
    const nextPages = builderPagesRef.current.map((p) =>
      p.slug === slug ? { ...p, published: publish, updatedAt: new Date().toISOString() } : p
    );
    const ok = await persistBuilderState(nextPages, builderFolders);
    if (!ok) {
      alert('Falha ao atualizar status da página.');
      return;
    }
    setBuilderPages(nextPages);
    alert(publish ? 'Página publicada.' : 'Página movida para rascunho.');
  };

  const persistBuilderPagesSetting = async (pages: BuilderPage[]) =>
    persistBuilderState(pages, builderFolders);

  const createBuilderFolder = async () => {
    if (!builderLoadedOnce) {
      alert('Aguarde o carregamento das páginas antes de criar uma pasta.');
      return;
    }
    const name = newBuilderFolderName.trim();
    if (!name) {
      alert('Informe o nome da pasta.');
      return;
    }
    setBuilderFolderSaving(true);
    try {
      const folder: BuilderFolder = {
        id: crypto.randomUUID(),
        name,
        sortOrder: builderFolders.length,
        createdAt: new Date().toISOString(),
      };
      const nextFolders = [...builderFolders, folder];
      const ok = await persistBuilderState(builderPages, nextFolders);
      if (!ok) {
        alert('Falha ao criar pasta.');
        return;
      }
      setBuilderFolders(nextFolders);
      setBuilderSelectedFolderId(folder.id);
      setNewBuilderFolderName('');
    } finally {
      setBuilderFolderSaving(false);
    }
  };

  const renameBuilderFolder = async (folder: BuilderFolder) => {
    const next = window.prompt('Novo nome da pasta:', folder.name);
    if (next === null) return;
    const name = next.trim();
    if (!name) {
      alert('O nome não pode ficar vazio.');
      return;
    }
    const nextFolders = builderFolders.map((f) => (f.id === folder.id ? { ...f, name } : f));
    const ok = await persistBuilderState(builderPages, nextFolders);
    if (!ok) {
      alert('Falha ao renomear pasta.');
      return;
    }
    setBuilderFolders(nextFolders);
  };

  const deleteBuilderFolder = async (folder: BuilderFolder) => {
    const count = builderPages.filter((p) => p.folderId === folder.id).length;
    if (count > 0) {
      alert(`Esta pasta contém ${count} página(s). Exclua ou mova as páginas antes de remover a pasta.`);
      return;
    }
    if (builderFolders.length <= 1) {
      alert('É necessário manter pelo menos uma pasta.');
      return;
    }
    if (!window.confirm(`Excluir a pasta "${folder.name}"?`)) return;
    const nextFolders = builderFolders.filter((f) => f.id !== folder.id);
    const ok = await persistBuilderState(builderPages, nextFolders);
    if (!ok) {
      alert('Falha ao excluir pasta.');
      return;
    }
    setBuilderFolders(nextFolders);
    if (builderSelectedFolderId === folder.id) {
      setBuilderSelectedFolderId(nextFolders[0]?.id ?? null);
    }
  };

  const moveBuilderPageFolder = async (slug: string, folderId: string) => {
    const nextPages = builderPages.map((p) =>
      p.slug === slug ? { ...p, folderId, updatedAt: new Date().toISOString() } : p
    );
    const ok = await persistBuilderState(nextPages, builderFolders);
    if (!ok) {
      alert('Falha ao mover página.');
      return;
    }
    setBuilderPages(nextPages);
  };

  const openBuilderPreviewNewTab = (mode: 'desktop' | 'mobile') => {
    const html = (builderCodeDraft || DEFAULT_BUILDER_HTML).trim() || DEFAULT_BUILDER_HTML;
    const css = mode === 'mobile'
      ? 'body{background:#e2e8f0 !important;padding:16px !important;} body>*{max-width:390px !important;margin:0 auto !important;box-shadow:0 0 0 1px rgba(2,6,23,.15);} '
      : '';
    const withCss = html.includes('</head>')
      ? html.replace('</head>', `<style>${css}</style></head>`)
      : `<style>${css}</style>${html}`;
    const blob = new Blob([withCss], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const openBuilderPublicUrl = () => {
    const slug = normalizeBuilderSlug(builderCurrentSlug);
    if (!slug) {
      alert('Salve a página antes de abrir a URL pública.');
      return;
    }
    const page = builderPagesRef.current.find((p) => p.slug === slug);
    if (!page) {
      alert('Página ainda não foi salva no banco.');
      return;
    }
    if (page.published === false) {
      alert('Página em rascunho. Clique em "Salvar e publicar" antes de abrir a URL pública.');
      return;
    }
    const publicUrl = `${window.location.origin}/${encodeURIComponent(slug)}`;
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  };

  // -- FETCHERS (JWT Bearer — não usa mais header x-admin-password na UI) --
  const validateAdminJwt = async (opts?: { silent?: boolean }, jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) {
      if (!opts?.silent) alert('Sessão do painel ausente.');
      setIsAdminLoggedIn(false);
      localStorage.removeItem(ADMIN_JWT_KEY);
      return;
    }
    try {
      const res = await fetch('/api/admin/users', { headers: h });
      if (res.ok) {
        setIsAdminLoggedIn(true);
        const tok = jwt ?? adminJwt;
        if (tok) localStorage.setItem(ADMIN_JWT_KEY, tok);
      } else {
        if (!opts?.silent) alert('Senha incorreta ou sessão inválida.');
        setIsAdminLoggedIn(false);
        localStorage.removeItem(ADMIN_JWT_KEY);
        setAdminJwt('');
      }
    } catch {
      if (!opts?.silent) alert('Servidor offline.');
    }
  };

  const fetchUsers = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/users', { headers: h });
      if (res.ok) setUsers(await res.json());
    } catch (err) {
      console.error('Error fetching users');
    }
  };

  const fetchWebhookLogs = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/webhook-logs', { headers: h });
      if (res.ok) setWebhookLogs(await res.json());
    } catch (err) {
      console.error('Error fetching webhook logs');
    }
  };

  const fetchWebhookUrls = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/webhook-urls', { headers: h });
      if (res.ok) setWebhookUrls(await res.json());
    } catch {
      console.error('Error fetching webhook urls');
    }
  };

  const fetchEmailSettings = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/settings', { headers: h });
      if (res.ok) {
        const data = await res.json();
        setEmailSettings((prev) => ({
          ...prev,
          ...data,
          welcome_template_pt: emailBodyFromStored(data.welcome_template_pt, DEFAULT_WELCOME_BODY_PT),
          reset_template_pt: emailBodyFromStored(data.reset_template_pt, DEFAULT_RESET_BODY_PT),
        }));
        if (!builderLoadedOnce) {
          const pagesRaw = String(data?.[PAGE_BUILDER_PAGES_SETTING_KEY] || '').trim();
          const foldersRaw = String(data?.[PAGE_BUILDER_FOLDERS_SETTING_KEY] || '').trim();
          const dbHadPagesJson = pagesRaw.length > 0;
          let parsedPages = parseBuilderPagesSetting(pagesRaw);
          const restoredFromLegacy = !parsedPages.length;
          if (restoredFromLegacy) {
            const legacyHtml = String(data?.[PAGE_BUILDER_LEGACY_SETTING_KEY] || '').trim();
            if (legacyHtml) {
              parsedPages = [{
                slug: 'pagina-principal',
                target: 'body',
                html: legacyHtml,
                updatedAt: new Date().toISOString(),
                published: true,
              }];
            }
          }
          const migrated = migrateBuilderFoldersAndPages(
            parsedPages,
            parseBuilderFoldersSetting(foldersRaw)
          );
          setBuilderPages(migrated.pages);
          setBuilderFolders(migrated.folders);
          setBuilderSelectedFolderId(migrated.folders[0]?.id ?? null);
          const first = migrated.pages[0];
          if (first) {
            setBuilderCurrentSlug(first.slug);
            setBuilderCodeDraft(first.html || DEFAULT_BUILDER_HTML);
            setBuilderPreviewHtml(first.html || DEFAULT_BUILDER_HTML);
          }
          setBuilderLoadedOnce(true);
          if (restoredFromLegacy && migrated.pages.length > 0 && (!dbHadPagesJson || pagesRaw === '[]')) {
            void persistBuilderState(migrated.pages, migrated.folders, { skipLoadGuard: true });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching email settings');
    }
  };

  const fetchLicenses = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/licenses', { headers: h });
      if (res.ok) setLicenses(await res.json());
    } catch {
      console.error('fetchLicenses');
    }
  };

  const fetchClientLicenses = async (email: string, jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    const em = String(email || '').toLowerCase().trim();
    if (!em) {
      setModalClientLicenses([]);
      return;
    }
    setModalLicensesLoading(true);
    try {
      const res = await fetch(`/api/admin/licenses?email=${encodeURIComponent(em)}`, { headers: h });
      if (res.ok) {
        const rows = await res.json();
        setModalClientLicenses(Array.isArray(rows) ? rows : []);
      }
    } catch {
      console.error('fetchClientLicenses');
    } finally {
      setModalLicensesLoading(false);
    }
  };

  const refreshLicensesAfterModalChange = (email?: string) => {
    void fetchLicenses();
    const em = email || managingAccessFor?.email;
    if (em) void fetchClientLicenses(em);
  };

  const fetchProducts = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/products', { headers: h });
      if (res.ok) setProducts(await res.json());
    } catch {
      console.error('fetchProducts');
    }
  };

  const fetchShortLinks = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/links', { headers: h });
      if (res.ok) setShortLinks(await res.json());
    } catch {
      console.error('fetchShortLinks');
    }
  };

  const fetchMediaFolders = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/media-folders', { headers: h });
      if (res.ok) {
        const rows = await res.json();
        setMediaFolders(rows);
        setMediaFolderFilter((prev) => {
          if (prev === 'none') return prev;
          if (typeof prev === 'string' && rows.some((f: { id: string }) => f.id === prev)) return prev;
          return rows[0]?.id ?? 'none';
        });
      }
    } catch {
      console.error('fetchMediaFolders');
    }
  };

  const fetchMediaAssets = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/media', { headers: h });
      if (res.ok) setMediaAssets(await res.json());
    } catch {
      console.error('fetchMediaAssets');
    }
  };

  const createMediaFolder = async () => {
    const name = newMediaFolderName.trim();
    if (!name) {
      alert('Informe o nome da pasta.');
      return;
    }
    setMediaFolderSaving(true);
    try {
      const res = await fetch('/api/admin/media-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as { error?: string }));
        alert(j.error || 'Falha ao criar pasta.');
        return;
      }
      const created = await res.json();
      setNewMediaFolderName('');
      await fetchMediaFolders();
      setMediaFolderFilter(created.id);
      setMediaUploadFolderId(created.id);
    } catch {
      alert('Erro de conexão ao criar pasta.');
    } finally {
      setMediaFolderSaving(false);
    }
  };

  const renameMediaFolder = async (folder: { id: string; name: string }) => {
    const next = window.prompt('Novo nome da pasta:', folder.name);
    if (next === null) return;
    const name = next.trim();
    if (!name) {
      alert('O nome não pode ficar vazio.');
      return;
    }
    const res = await fetch(`/api/admin/media-folders/${folder.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as { error?: string }));
      alert(j.error || 'Falha ao renomear pasta.');
      return;
    }
    void fetchMediaFolders();
    void fetchMediaAssets();
  };

  const deleteMediaFolder = async (folder: { id: string; name: string }) => {
    if (!window.confirm(`Excluir a pasta "${folder.name}"? Os arquivos permanecem na biblioteca (sem pasta).`)) return;
    const res = await fetch(`/api/admin/media-folders/${folder.id}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as { error?: string }));
      alert(j.error || 'Falha ao excluir pasta.');
      return;
    }
    if (mediaFolderFilter === folder.id) {
      const remaining = mediaFolders.filter((f: any) => f.id !== folder.id);
      setMediaFolderFilter(remaining[0]?.id ?? 'none');
    }
    if (mediaUploadFolderId === folder.id) setMediaUploadFolderId('');
    void fetchMediaFolders();
    void fetchMediaAssets();
  };

  const moveMediaToFolder = async (mediaId: string, folderId: string) => {
    const res = await fetch(`/api/admin/media/${mediaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ folderId: folderId || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as { error?: string }));
      alert(j.error || 'Falha ao mover arquivo.');
      return;
    }
    void fetchMediaAssets();
    void fetchMediaFolders();
  };

  const fetchCourses = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/courses', { headers: { ...h } });
      if (!res.ok) {
        const fallback = await fetch('/api/public/courses');
        const data = await fallback.json().catch(() => []);
        setCourses(Array.isArray(data) ? data : []);
        return;
      }
      const data = await res.json().catch(() => []);
      setCourses(Array.isArray(data) ? data : []);
    } catch {
      setCourses([]);
    }
  };

  const fetchForexSettings = async (jwt?: string) => {
    const h = authHeaders(jwt);
    if (!h.Authorization) return;
    try {
      const res = await fetch('/api/admin/settings', { headers: h });
      if (res.ok) {
        const s = await res.json();
        setForexWebhook(s.forex_webhook_token || '');
        try {
          const keys = JSON.parse(s.forex_api_keys || '[]');
          setForexApiLines(Array.isArray(keys) ? keys.join('\n') : '');
        } catch {
          setForexApiLines('');
        }
      }
    } catch {
      console.error('fetchForexSettings');
    }
  };

  const saveEmailSettings = async () => {
    const h = authHeaders();
    if (!h.Authorization) return;
    setEmailSaving(true);
    try {
      const res = await fetch('/api/admin/email-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({
          resend_api_key: emailSettings.resend_api_key ?? '',
          sender_name: emailSettings.sender_name ?? '',
          sender_email: emailSettings.sender_email ?? '',
          welcome_template_pt: emailSettings.welcome_template_pt ?? DEFAULT_WELCOME_BODY_PT,
          reset_template_pt: emailSettings.reset_template_pt ?? DEFAULT_RESET_BODY_PT,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(j.error || 'Erro ao salvar configurações de e-mail.');
        return;
      }
      alert('Configurações salvas com sucesso!');
      void fetchEmailSettings();
    } catch {
      alert('Erro de conexão.');
    } finally {
      setEmailSaving(false);
    }
  };

  const sendTestEmail = async () => {
    const h = authHeaders();
    if (!h.Authorization) return;
    const to = testEmailTo.trim().toLowerCase();
    if (!to) {
      alert('Informe o e-mail de destino do teste.');
      return;
    }
    setTestEmailSending(true);
    try {
      const res = await fetch('/api/admin/email-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ to }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        to?: string;
        from?: string;
      };
      if (!res.ok) {
        alert(j.error || 'Falha ao enviar e-mail de teste.');
        return;
      }
      alert(
        j.message ||
          `E-mail de teste enviado para ${j.to || to}. Verifique a caixa de entrada (e spam). Remetente: ${j.from || '—'}.`
      );
    } catch {
      alert('Erro de conexão.');
    } finally {
      setTestEmailSending(false);
    }
  };

  const saveMemberBanner = async () => {
    const h = authHeaders();
    if (!h.Authorization) return;
    setBannerSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_hero_background_url: emailSettings.member_hero_background_url ?? '',
          member_hero_kicker: emailSettings.member_hero_kicker ?? ''
        })
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Erro ao salvar.');
      } else {
        alert('Banner salvo. Se a URL estiver vazia, a home pode usar a capa do curso em destaque (ver Cursos EAD).');
        void fetchEmailSettings();
      }
    } catch {
      alert('Erro de conexão.');
    } finally {
      setBannerSaving(false);
    }
  };

  const saveMemberTheme = async () => {
    const h = authHeaders();
    if (!h.Authorization) return;
    setThemeSaving(true);
    try {
      const payload = {
        member_theme_bg_main: String(emailSettings.member_theme_bg_main || '').trim(),
        member_theme_bg_secondary: String(emailSettings.member_theme_bg_secondary || '').trim(),
        member_theme_bg_card: String(emailSettings.member_theme_bg_card || '').trim(),
        member_theme_text_primary: String(emailSettings.member_theme_text_primary || '').trim(),
        member_theme_text_secondary: String(emailSettings.member_theme_text_secondary || '').trim(),
        member_theme_accent_primary: String(emailSettings.member_theme_accent_primary || '').trim(),
        member_theme_accent_primary_hover: String(emailSettings.member_theme_accent_primary_hover || '').trim(),
        member_theme_border_subtle: String(emailSettings.member_theme_border_subtle || '').trim(),
        member_theme_button_text: String(emailSettings.member_theme_button_text || '').trim(),
        member_theme_video_accent: String(emailSettings.member_theme_video_accent || '').trim(),
      };
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Erro ao salvar tema.');
        return;
      }
      alert('Tema salvo. Atualize a área de membros para ver tudo aplicado.');
      void fetchEmailSettings();
    } catch {
      alert('Erro de conexão.');
    } finally {
      setThemeSaving(false);
    }
  };

  const resetMemberTheme = async () => {
    const h = authHeaders();
    if (!h.Authorization) return;
    setEmailSettings((p) => ({ ...p, ...MEMBER_THEME_DEFAULTS }));
    setThemeSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(MEMBER_THEME_DEFAULTS),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Erro ao restaurar tema.');
        return;
      }
      alert('Cores restauradas para o padrão. Atualize a área de membros para ver o resultado.');
      void fetchEmailSettings();
    } catch {
      alert('Erro de conexão.');
    } finally {
      setThemeSaving(false);
    }
  };

  const loadDashboard = async (jwt: string) => {
    try {
      await validateAdminJwt({ silent: true }, jwt);
      await Promise.all([
        fetchUsers(jwt),
        fetchWebhookLogs(jwt),
        fetchWebhookUrls(jwt),
        fetchEmailSettings(jwt),
        fetchLicenses(jwt),
        fetchProducts(jwt),
        fetchShortLinks(jwt),
        fetchMediaAssets(jwt),
        fetchMediaFolders(jwt),
        fetchForexSettings(jwt),
        fetchCourses(jwt),
      ]);
    } finally {
      setAuthBootstrapping(false);
    }
  };

  const selectedCourse = useMemo(() => courses.find((c: any) => c.id === selectedCourseId) || null, [courses, selectedCourseId]);
  const selectedModules = (selectedCourse?.modules || []) as any[];
  const selectedModule = useMemo(
    () => (selectedModules as any[]).find((m: any) => m.id === selectedModuleId) || null,
    [selectedModules, selectedModuleId]
  );
  const selectedLesson = useMemo(() => {
    if (!selectedLessonId || !selectedCourse) return null;
    for (const m of selectedCourse.modules || []) {
      const l = (m.lessons || []).find((x: any) => x.id === selectedLessonId);
      if (l) return l;
    }
    return null;
  }, [selectedCourse, selectedLessonId]);

  useEffect(() => {
    if (!selectedCourseId) {
      setSelectedModuleId('');
      setSelectedLessonId('');
      return;
    }
    if (selectedModules.length === 0) {
      setSelectedModuleId('');
      setSelectedLessonId('');
      return;
    }
    const stillExists = selectedModules.some((m: any) => m.id === selectedModuleId);
    if (selectedModuleId && !stillExists) setSelectedModuleId('');
  }, [selectedCourseId, selectedModules, selectedModuleId]);

  useEffect(() => {
    setSelectedLessonId('');
  }, [selectedCourseId, selectedModuleId]);

  useEffect(() => {
    if (selectedLessonId) {
      setEadSectionTab('aula');
      setEadLessonSubtab('editar');
    }
  }, [selectedLessonId]);

  useEffect(() => {
    if (!selectedLessonId && selectedModuleId) {
      setEadLessonSubtab('nova');
    }
  }, [selectedModuleId, selectedLessonId]);

  useEffect(() => {
    if (!selectedCourseId) {
      setEadSectionTab('curso');
    }
  }, [selectedCourseId]);

  useEffect(() => {
    if (!selectedCourse) {
      setEditCourseTitle('');
      setEditCourseSlug('');
      setEditCoursePublished(true);
      setEditCourseProductIds('');
      setEditCourseSalesPageUrl('');
      setEditCourseMemberPageUrl('');
      return;
    }
    setEditCourseTitle(selectedCourse.title || '');
    setEditCourseSlug(selectedCourse.slug || '');
    setEditCoursePublished(selectedCourse.published !== false);
    setEditCourseProductIds(selectedCourse.productIds || '');
    setEditCourseSalesPageUrl(selectedCourse.salesPageUrl || '');
    setEditCourseMemberPageUrl(selectedCourse.memberPageUrl || '');
    setEditCourseCoverFile(null);
  }, [
    selectedCourseId,
    selectedCourse?.title,
    selectedCourse?.slug,
    selectedCourse?.published,
    selectedCourse?.productIds,
    selectedCourse?.salesPageUrl,
    selectedCourse?.memberPageUrl,
  ]);

  useEffect(() => {
    setEditModuleTitle(selectedModule?.title || '');
  }, [selectedModuleId, selectedModule?.title]);

  useEffect(() => {
    if (!selectedLesson) {
      setEditLessonTitle('');
      setEditLessonVideoUrl('');
      setEditLessonBodyText('');
      setEditLessonActionLabel('');
      setEditLessonActionUrl('');
      return;
    }
    setEditLessonTitle(selectedLesson.title || '');
    setEditLessonVideoUrl(selectedLesson.videoUrl || '');
    setEditLessonBodyText(selectedLesson.bodyText || '');
    setEditLessonActionLabel(selectedLesson.actionLabel || '');
    setEditLessonActionUrl(selectedLesson.actionUrl || '');
  }, [selectedLessonId, selectedLesson]);

  const mergedClients = useMemo(() => {
    const byEmail = new Map<string, any>();
    for (const u of users) {
      const email = String(u?.email || '').toLowerCase().trim();
      if (!email) continue;
      byEmail.set(email, { ...u, _isLicenseOnly: false });
    }
    for (const l of licenses) {
      const email = String((l as { email?: string }).email || '').toLowerCase().trim();
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, {
        id: `lic_${email}`,
        email,
        name: (l as { buyerName?: string }).buyerName || null,
        password: null,
        purchases: [],
        _isLicenseOnly: true,
      });
    }
    return Array.from(byEmail.values());
  }, [users, licenses]);

  const licensePlansByEmail = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of licenses as Array<{ email?: string; plano?: string | null }>) {
      const email = String(l.email || '').toLowerCase().trim();
      if (!email) continue;
      const plan = String(l.plano || '').toLowerCase().trim();
      if (!plan) continue;
      if (!m.has(email)) m.set(email, new Set());
      m.get(email)!.add(plan);
    }
    return m;
  }, [licenses]);

  const licenseStatusSetByEmail = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of licenses as Array<{ email?: string; statusLicenca?: string | null; dataExpiracao?: string | null }>) {
      const email = String(l.email || '').toLowerCase().trim();
      if (!email) continue;
      const st = effectiveLicenseStatus(l.statusLicenca, l.dataExpiracao);
      if (!m.has(email)) m.set(email, new Set());
      m.get(email)!.add(st);
    }
    return m;
  }, [licenses]);

  const latestPurchaseKeyByEmail = useMemo(() => {
    const m = new Map<string, number>();
    const consider = (emailRaw: unknown, dateLike: unknown) => {
      const email = String(emailRaw || '').toLowerCase().trim();
      if (!email) return;
      const t = dateLike instanceof Date ? dateLike.getTime() : Date.parse(String(dateLike || ''));
      if (!Number.isFinite(t)) return;
      const prev = m.get(email) || 0;
      if (t > prev) m.set(email, t);
    };

    // Ordenação por "ordem de compra": usa apenas datas da licença (ativação/criação).
    // Não usa expiração porque pode ser futura e distorcer "mais novo".
    for (const l of licenses as Array<{ email?: string; createdAt?: string | Date; dataAtivacao?: string | Date; id?: number }>) {
      consider(l.email, l.dataAtivacao);
      consider(l.email, l.createdAt);
    }

    return m;
  }, [users, licenses]);

  const availablePlanFilters = useMemo(() => {
    const set = new Set<string>();
    for (const plans of licensePlansByEmail.values()) {
      for (const p of plans) set.add(p);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [licensePlansByEmail]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    return mergedClients.filter((u: any) => {
      const email = String(u.email || '').toLowerCase().trim();
      const name = String(u.name || '').toLowerCase().trim();
      const textOk = !q || email.includes(q) || name.includes(q);
      if (!textOk) return false;

      const plans = licensePlansByEmail.get(email);
      if (userPlanFilter !== 'todos' && !plans?.has(userPlanFilter)) return false;

      const statuses = licenseStatusSetByEmail.get(email);
      if (userStatusFilter === 'sem_licenca') return !statuses || statuses.size === 0;
      if (userStatusFilter !== 'todos' && !statuses?.has(userStatusFilter)) return false;

      return true;
    });
  }, [mergedClients, userSearch, userPlanFilter, userStatusFilter, licensePlansByEmail, licenseStatusSetByEmail]);

  useEffect(() => {
    setPageUsers(1);
  }, [userSearch, userPlanFilter, userStatusFilter, userSort]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(filteredUsers.length / ADMIN_TABLE_PAGE_SIZE));
    setPageUsers((p) => Math.min(p, tp));
  }, [filteredUsers.length]);

  const sortedFilteredUsers = useMemo(() => {
    const dir = userSort === 'oldest' ? 1 : -1;
    const arr = [...filteredUsers];
    arr.sort((a: any, b: any) => {
      const ea = String(a?.email || '').toLowerCase().trim();
      const eb = String(b?.email || '').toLowerCase().trim();
      const ta = latestPurchaseKeyByEmail.get(ea) || 0;
      const tb = latestPurchaseKeyByEmail.get(eb) || 0;
      if (ta !== tb) return (ta - tb) * dir;
      return ea.localeCompare(eb, 'pt-BR');
    });
    return arr;
  }, [filteredUsers, latestPurchaseKeyByEmail, userSort]);

  const usersTotalPages = Math.max(1, Math.ceil(filteredUsers.length / ADMIN_TABLE_PAGE_SIZE));
  const usersPageEff = Math.min(pageUsers, usersTotalPages);
  const pagedUsers = useMemo(() => {
    const start = (usersPageEff - 1) * ADMIN_TABLE_PAGE_SIZE;
    return sortedFilteredUsers.slice(start, start + ADMIN_TABLE_PAGE_SIZE);
  }, [sortedFilteredUsers, usersPageEff]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(products.length / ADMIN_TABLE_PAGE_SIZE));
    setPageProducts((p) => Math.min(p, tp));
  }, [products.length]);

  const productsTotalPages = Math.max(1, Math.ceil(products.length / ADMIN_TABLE_PAGE_SIZE));
  const productsPageEff = Math.min(pageProducts, productsTotalPages);
  const pagedProducts = useMemo(() => {
    const start = (productsPageEff - 1) * ADMIN_TABLE_PAGE_SIZE;
    return products.slice(start, start + ADMIN_TABLE_PAGE_SIZE);
  }, [products, productsPageEff]);

  const licenseCountByEmail = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of licenses) {
      const k = String((l as { email?: string }).email || '')
        .toLowerCase()
        .trim();
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [licenses]);

  const licenseStatusCountsByEmail = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const l of licenses) {
      const k = String((l as { email?: string }).email || '')
        .toLowerCase()
        .trim();
      if (!k) continue;
      const st = effectiveLicenseStatus(
        (l as { statusLicenca?: string }).statusLicenca,
        (l as { dataExpiracao?: string | null }).dataExpiracao
      );
      if (!m.has(k)) m.set(k, new Map());
      const inner = m.get(k)!;
      inner.set(st, (inner.get(st) || 0) + 1);
    }
    return m;
  }, [licenses]);

  const licenseCounters = useMemo(() => {
    let ativas = 0;
    let desativadas = 0;
    let testesAtivos = 0;
    for (const l of licenses as Array<{ statusLicenca?: string; dataExpiracao?: string | null; plano?: string | null }>) {
      const st = effectiveLicenseStatus(l.statusLicenca, l.dataExpiracao);
      const plano = String(l.plano || '').toLowerCase();
      if (st === 'ativa') ativas++;
      if (st === 'inativa' || st === 'expirada') desativadas++;
      if (st === 'ativa' && plano.includes('teste')) testesAtivos++;
    }
    return { ativas, desativadas, testesAtivos };
  }, [licenses]);

  const selectedManualProduct = useMemo(
    () => products.find((p: any) => String(p.id) === newUserProductId) || null,
    [products, newUserProductId]
  );

  useEffect(() => {
    if (selectedManualProduct?.plano) {
      setNewUserPlan(String(selectedManualProduct.plano));
    }
  }, [selectedManualProduct?.id, selectedManualProduct?.plano]);

  const licensesForClientModal = useMemo(() => {
    return [...modalClientLicenses].sort((a: { id: number }, b: { id: number }) => b.id - a.id);
  }, [modalClientLicenses]);

  const productNameByLicense = useMemo(() => {
    return (license: { systemId?: string; plano?: string; offerCode?: string }) => {
      const matched = resolveProductForLicense(
        products as Array<{ id: number; systemId?: string; productName?: string; offerCode?: string; plano?: string }>,
        license
      );
      return matched?.productName || String(license.systemId || '').trim() || '—';
    };
  }, [products]);

  const licenseFormSelectedProductId = useMemo(() => {
    const matched = resolveProductForLicense(
      products as Array<{ id: number; systemId?: string; productName?: string; offerCode?: string; plano?: string }>,
      {
        systemId: licenseForm.systemId,
        plano: licenseForm.plano,
        offerCode: licenseForm.offerCode,
      }
    );
    return matched?.id != null ? String(matched.id) : '';
  }, [products, licenseForm.systemId, licenseForm.plano, licenseForm.offerCode]);

  const licenseFormSelectedProductName = useMemo(() => {
    if (!licenseFormSelectedProductId) return '';
    const p = (products as Array<{ id: number; productName?: string }>).find(
      (x) => String(x.id) === licenseFormSelectedProductId
    );
    return p?.productName || '';
  }, [products, licenseFormSelectedProductId]);

  useEffect(() => {
    if (!managingAccessFor?.email) {
      setModalClientLicenses([]);
      return;
    }
    void fetchClientLicenses(managingAccessFor.email);
    setLicenseForm({
      systemId: '',
      plano: 'mensal',
      statusLicenca: 'ativa',
      dataExpiracao: planExpiryLocalValue('mensal'),
      numeroConta: '',
      offerCode: '',
    });
    setEditingLicenseId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- email do modal
  }, [managingAccessFor?.id, managingAccessFor?.email]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(webhookLogs.length / ADMIN_TABLE_PAGE_SIZE));
    setPageWebhooks((p) => Math.min(p, tp));
  }, [webhookLogs.length]);

  const webhooksPageEff = Math.min(pageWebhooks, Math.max(1, Math.ceil(webhookLogs.length / ADMIN_TABLE_PAGE_SIZE)));
  const pagedWebhookLogs = useMemo(() => {
    const start = (webhooksPageEff - 1) * ADMIN_TABLE_PAGE_SIZE;
    return webhookLogs.slice(start, start + ADMIN_TABLE_PAGE_SIZE);
  }, [webhookLogs, webhooksPageEff]);

  const slugify = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80);

  const csvToList = (csv: string) => csv.split(',').map((s) => s.trim()).filter(Boolean);
  const csvAdd = (csv: string, value: string) => {
    const cur = csvToList(csv);
    if (cur.includes(value)) return csv;
    cur.push(value);
    return cur.join(',');
  };
  const csvRemove = (csv: string, value: string) =>
    csvToList(csv)
      .filter((x) => x !== value)
      .join(',');

  const renderProductPicker = (csvValue: string, setCsvValue: (v: string) => void) => {
    const selectedIds = new Set(csvToList(csvValue));
    return (
      <div className="admin-sid-picker">
        {selectedIds.size === 0 ? (
          <p className="admin-sid-empty">Curso público — qualquer usuário logado pode acessar.</p>
        ) : (
          <div className="admin-sid-selected" role="list">
            {[...selectedIds].map((pid) => {
              const p = products.find((pp: any) => String(pp.id) === pid);
              const label = p ? `${p.productName}` : `Produto #${pid}`;
              const sid = p?.systemId || '';
              const offer = p?.offerCode || '';
              return (
                <span key={`sel-${pid}`} className="admin-sid-chip admin-sid-chip--selected" role="listitem">
                  <span className="admin-sid-chip-name">{label}</span>
                  {sid ? <span className="admin-sid-chip-sid">sys: {sid}</span> : null}
                  {offer ? <span className="admin-sid-chip-sid">oferta: {offer}</span> : null}
                  <button
                    type="button"
                    className="admin-sid-chip-x"
                    onClick={() => setCsvValue(csvRemove(csvValue, pid))}
                    aria-label={`Remover ${label}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {products.length > 0 && (
          <div className="admin-sid-available">
            <div className="admin-sid-available-label">Produtos cadastrados</div>
            <div className="admin-sid-chips-row">
              {products.map((p: any) => {
                const pid = String(p.id);
                const isActive = selectedIds.has(pid);
                const sid = p.systemId || '';
                const offer = p.offerCode || '';
                return (
                  <button
                    key={`opt-${pid}`}
                    type="button"
                    className={`admin-sid-chip${isActive ? ' admin-sid-chip--active' : ''}`}
                    onClick={() => setCsvValue(isActive ? csvRemove(csvValue, pid) : csvAdd(csvValue, pid))}
                    title={`${p.productName}${sid ? ` — sys ${sid}` : ''}${offer ? ` — oferta ${offer}` : ''}`}
                  >
                    <span className="admin-sid-chip-mark" aria-hidden>
                      {isActive ? '✓' : '+'}
                    </span>
                    <span className="admin-sid-chip-name">{p.productName}</span>
                    {sid ? <span className="admin-sid-chip-sid">{sid}</span> : null}
                    {offer ? <span className="admin-sid-chip-sid admin-sid-chip-offer">#{offer}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newCourseTitle.trim();
    const slug = (newCourseSlug.trim() || slugify(title)).trim();
    if (!title || !slug) return;
    try {
      let coverUrl: string | null = null;
      if (newCourseCoverFile) {
        coverUrl = await uploadFile(newCourseCoverFile);
      }
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title,
          slug,
          coverUrl,
          productIds: newCourseProductIds.trim() || null,
          salesPageUrl: newCourseSalesPageUrl.trim() || null,
          memberPageUrl: newCourseMemberPageUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Falha ao criar curso.');
        return;
      }
      setNewCourseTitle('');
      setNewCourseSlug('');
      setNewCourseCoverFile(null);
      setNewCourseProductIds('');
      setNewCourseMemberPageUrl('');
      setNewCourseSalesPageUrl('');
      await fetchCourses();
      alert('Curso criado. Com capa, ele pode aparecer no banner da home se não houver imagem fixa em Banner início.');
    } catch {
      alert('Servidor offline.');
    }
  };

  const handleCreateModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseId) return;
    const title = newModuleTitle.trim();
    if (!title) return;
    try {
      const res = await fetch('/api/admin/course-modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ courseId: selectedCourseId, title }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Falha ao criar módulo.');
        return;
      }
      setNewModuleTitle('');
      await fetchCourses();
      alert('Módulo criado.');
    } catch {
      alert('Servidor offline.');
    }
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModuleId) return;
    const title = newLessonTitle.trim();
    if (!title) return;
    try {
      const res = await fetch('/api/admin/course-lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          moduleId: selectedModuleId,
          title,
          contentId: null,
          videoUrl: newLessonVideoUrl.trim() || null,
          bodyText: sanitizeLessonBodyHtml(newLessonBodyText) || null,
          actionLabel: newLessonActionLabel.trim() || null,
          actionUrl: newLessonActionUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Falha ao criar aula.');
        return;
      }
      setNewLessonTitle('');
      setNewLessonVideoUrl('');
      setNewLessonBodyText('');
      setNewLessonActionLabel('');
      setNewLessonActionUrl('');
      await fetchCourses();
      alert('Aula criada.');
    } catch {
      alert('Servidor offline.');
    }
  };

  const reorderModuleLessons = async (moduleId: string, lessonIds: string[]) => {
    const res = await fetch(`/api/admin/course-modules/${moduleId}/reorder-lessons`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ lessonIds }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as { error?: string }).error || 'Falha ao reordenar aulas.');
    }
  };

  const moveLessonToTarget = async (moduleId: string, insertIndex: number) => {
    if (!draggedLessonId) return;
    const module = selectedModules.find((m: any) => m.id === moduleId);
    const lessons = (module?.lessons || []) as any[];
    if (!lessons.length) return;

    const fromIndex = lessons.findIndex((l: any) => l.id === draggedLessonId);
    if (fromIndex < 0) return;

    const withoutDragged = lessons.filter((l: any) => l.id !== draggedLessonId);
    const targetIndex = Math.max(0, Math.min(insertIndex, withoutDragged.length));

    const reordered = [...withoutDragged];
    reordered.splice(targetIndex, 0, lessons[fromIndex]);
    const reorderedIds = reordered.map((l: any) => l.id);
    const originalIds = lessons.map((l: any) => l.id);
    if (reorderedIds.join('|') === originalIds.join('|')) return;

    setCourses((prev) =>
      prev.map((c: any) =>
        c.id !== selectedCourseId
          ? c
          : {
              ...c,
              modules: (c.modules || []).map((m: any) =>
                m.id !== moduleId
                  ? m
                  : {
                      ...m,
                      lessons: reordered.map((l: any, idx: number) => ({ ...l, sortOrder: idx })),
                    }
              ),
            }
      )
    );

    try {
      await reorderModuleLessons(moduleId, reorderedIds);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao reordenar aulas.');
      await fetchCourses();
    } finally {
      setDragOverModuleId('');
      setDragOverInsertIndex(null);
      setDraggedLessonId('');
    }
  };

  const handleSaveCourse = async () => {
    if (!selectedCourseId || !editCourseTitle.trim() || !editCourseSlug.trim()) return;
    try {
      let coverUrl: string | undefined = undefined;
      if (editCourseCoverFile) coverUrl = await uploadFile(editCourseCoverFile);
      const res = await fetch(`/api/admin/courses/${selectedCourseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: editCourseTitle.trim(),
          slug: editCourseSlug.trim(),
          published: editCoursePublished,
          productIds: editCourseProductIds.trim() || null,
          salesPageUrl: editCourseSalesPageUrl.trim() || null,
          memberPageUrl: editCourseMemberPageUrl.trim() || null,
          ...(coverUrl !== undefined ? { coverUrl } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert((d as { error?: string }).error || 'Falha ao salvar curso.');
        return;
      }
      setEditCourseCoverFile(null);
      await fetchCourses();
      alert('Curso atualizado.');
    } catch {
      alert('Servidor offline.');
    }
  };

  const handleDeleteCourse = async () => {
    if (!selectedCourseId) return;
    if (!window.confirm('Excluir este curso e todos os módulos e aulas?')) return;
    try {
      const res = await fetch(`/api/admin/courses/${selectedCourseId}`, { method: 'DELETE', headers: { ...authHeaders() } });
      if (!res.ok) {
        alert('Falha ao excluir.');
        return;
      }
      setSelectedCourseId('');
      setSelectedModuleId('');
      setSelectedLessonId('');
      await fetchCourses();
    } catch {
      alert('Erro.');
    }
  };

  const handleSaveModule = async () => {
    if (!selectedModuleId || !editModuleTitle.trim()) return;
    try {
      const res = await fetch(`/api/admin/course-modules/${selectedModuleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: editModuleTitle.trim() }),
      });
      if (!res.ok) {
        alert('Falha ao salvar módulo.');
        return;
      }
      await fetchCourses();
      alert('Módulo atualizado.');
    } catch {
      alert('Erro.');
    }
  };

  const handleDeleteModule = async () => {
    if (!selectedModuleId) return;
    if (!window.confirm('Excluir este módulo e todas as aulas?')) return;
    try {
      await fetch(`/api/admin/course-modules/${selectedModuleId}`, { method: 'DELETE', headers: { ...authHeaders() } });
      setSelectedModuleId('');
      setSelectedLessonId('');
      await fetchCourses();
    } catch {
      alert('Erro.');
    }
  };

  const handleSaveLesson = async () => {
    if (!selectedLessonId || !editLessonTitle.trim()) return;
    try {
      const res = await fetch(`/api/admin/course-lessons/${selectedLessonId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: editLessonTitle.trim(),
          contentId: null,
          videoUrl: editLessonVideoUrl.trim() || null,
          bodyText: sanitizeLessonBodyHtml(editLessonBodyText) || null,
          actionLabel: editLessonActionLabel.trim() || null,
          actionUrl: editLessonActionUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        alert('Falha ao salvar aula.');
        return;
      }
      await fetchCourses();
      alert('Aula atualizada.');
    } catch {
      alert('Erro.');
    }
  };

  const handleDeleteLesson = async () => {
    if (!selectedLessonId) return;
    if (!window.confirm('Excluir esta aula?')) return;
    try {
      await fetch(`/api/admin/course-lessons/${selectedLessonId}`, { method: 'DELETE', headers: { ...authHeaders() } });
      setSelectedLessonId('');
      await fetchCourses();
    } catch {
      alert('Erro.');
    }
  };

  useEffect(() => {
    const j = localStorage.getItem(ADMIN_JWT_KEY);
    const legacyPwd = localStorage.getItem('adminToken');
    if (j) {
      setAdminJwt(j);
      setAuthBootstrapping(true);
      void loadDashboard(j);
    } else if (legacyPwd) {
      setAuthBootstrapping(true);
      void (async () => {
        try {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: '', password: legacyPwd }),
          });
          const data = await res.json().catch(() => ({} as { token?: string }));
          if (res.ok && data.token) {
            localStorage.setItem(ADMIN_JWT_KEY, data.token);
            localStorage.removeItem('adminToken');
            setAdminJwt(data.token);
            await loadDashboard(data.token);
          } else {
            localStorage.removeItem('adminToken');
            setAuthBootstrapping(false);
          }
        } catch {
          localStorage.removeItem('adminToken');
          setAuthBootstrapping(false);
        }
      })();
    } else {
      setAuthBootstrapping(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = adminEmail.trim();
    if (!email || !masterPassword) return;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: masterPassword }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; token?: string }));
      if (!res.ok) {
        alert(data.error || 'E-mail ou senha incorretos.');
        return;
      }
      if (!data.token) {
        alert('Resposta inválida da API.');
        return;
      }
      setAdminJwt(data.token);
      localStorage.setItem(ADMIN_JWT_KEY, data.token);
      localStorage.removeItem('adminToken');
      setAdminEmail('');
      setMasterPassword('');
      await loadDashboard(data.token);
    } catch {
      alert('Servidor offline.');
    }
  };

  // -- USERS MANAGEMENT --
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: String(newUserName || '').trim() || null,
          email: newUserEmail,
          password: newUserPass
        })
      });
      if (res.ok) {
        if (!selectedManualProduct?.systemId) {
          alert('Escolha um produto para o cadastro manual.');
          return;
        }
        const licRes = await fetch('/api/admin/licenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            email: String(newUserEmail).toLowerCase().trim(),
            buyerName: String(newUserName || '').trim() || null,
            systemId: String(selectedManualProduct.systemId || '').trim(),
            plano: (newUserPlan || selectedManualProduct.plano || 'mensal').trim(),
            statusLicenca: 'ativa',
            numeroConta: '',
          })
        });
        if (!licRes.ok) {
          const j = await licRes.json().catch(() => ({}));
          alert(j.error || 'Usuário criado, mas falhou ao criar licença manual.');
        } else {
          alert('Cliente e licença criados com sucesso!');
        }
        setNewUserName('');
        setNewUserEmail('');
        setNewUserPass('');
        setNewUserProductId('');
        setNewUserPlan('mensal');
        void fetchUsers();
        void fetchLicenses();
      } else {
        const errorData = await res.json();
        alert(errorData.error);
      }
    } catch(err) { alert('Erro na comunicação'); }
  };

  const handleDeleteUser = async (user: any) => {
    const isLicenseOnly = Boolean(user._isLicenseOnly);
    const msg = isLicenseOnly
      ? `⚠️ Excluir TODAS as licenças EA do e-mail ${user.email}? Não há conta de área de membros — apenas as licenças serão removidas.`
      : `⚠️ Tem certeza que deseja EXCLUIR permanentemente o usuário ${user.email}, suas licenças EA e todos os históricos? Essa ação é IRREVERSÍVEL.`;
    if (!window.confirm(msg)) return;
    try {
      const res = isLicenseOnly
        ? await fetch(`/api/admin/license-clients?email=${encodeURIComponent(user.email)}`, {
            method: 'DELETE',
            headers: { ...authHeaders() },
          })
        : await fetch(`/api/admin/users/${user.id}`, {
            method: 'DELETE',
            headers: { ...authHeaders() },
          });
      if (res.ok) {
        alert(isLicenseOnly ? 'Licenças removidas com sucesso!' : 'Usuário excluído com sucesso!');
        void fetchUsers();
        void fetchLicenses();
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Falha ao excluir.');
      }
    } catch (err) {
      alert('Erro na comunicação com servidor.');
    }
  };

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/admin/upload', {
      method: 'POST', headers: { ...authHeaders() }, body: formData
    });
    const data = await res.json();
    return data.url;
  };

  // LOGIN SCREEN
  if (!isAdminLoggedIn) {
    if (authBootstrapping) {
      return (
        <div className="admin-login-container">
          <p className="admin-login-bootstrapping">Restaurando sua sessão…</p>
        </div>
      );
    }
    return (
      <div className="admin-login-container">
        <form onSubmit={handleLogin} className="admin-login-box">
          <h2>Centro de Comando</h2>
          <p>Exclusivo ao Criador</p>
          <input
            type="email"
            autoComplete="username"
            placeholder="E-mail do administrador"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Senha"
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            required
          />
          {import.meta.env.DEV && (
            <p className="admin-login-dev-hint" style={{ fontSize: '13px', color: '#8ab4b0', marginTop: '8px', lineHeight: 1.4 }}>
              Use <code style={{ color: '#93c5fd' }}>ADMIN_EMAIL</code> e <code style={{ color: '#93c5fd' }}>ADMIN_PASSWORD</code> do <code style={{ color: '#93c5fd' }}>.env</code> (dev: <strong style={{ color: 'var(--accent-primary)' }}>admin@local.dev</strong> / <strong style={{ color: 'var(--accent-primary)' }}>AdminTeste@local</strong>).
            </p>
          )}
          <button type="submit">Autenticar Sistema</button>
        </form>
      </div>
    );
  }

  const adminTabMeta: Record<string, { title: string; subtitle: string }> = {
    courses: {
      title: 'Cursos EAD',
      subtitle: 'Organize trilhas, módulos e aulas com edição rápida do que já está publicado.',
    },
    banner: {
      title: 'Banner início',
      subtitle: 'Defina o visual de abertura da área do membro.',
    },
    users: {
      title: 'Clientes',
      subtitle: 'Cadastro de alunos e licenças EA por e-mail e systemId (produto).',
    },
    webhooks: {
      title: 'Webhook',
      subtitle: 'Configure integração e acompanhe logs de eventos.',
    },
    email: {
      title: 'E-mail',
      subtitle: 'Centralize remetente, templates e envios transacionais.',
    },
    products: {
      title: 'Produtos',
      subtitle: 'Cadastre produtos e versões com organização comercial.',
    },
    links: {
      title: 'WP Links',
      subtitle: 'Gerencie links curtos, UTM e redirecionamentos como no WordPress.',
    },
    media: {
      title: 'Biblioteca de mídia',
      subtitle: 'Faça upload de imagens, vídeos e arquivos com link pronto para usar.',
    },
    support: {
      title: 'Suporte',
      subtitle: 'Defina para onde o cliente será enviado ao clicar em Suporte.',
    },
    builder: {
      title: 'Construtor HTML',
      subtitle: 'Edite código, clique em elementos e ajuste visualmente.',
    },
    forexEA: {
      title: 'Segurança EA',
      subtitle: 'Ajuste chaves e proteção da camada operacional.',
    },
  };
  const currentAdminMeta = adminTabMeta[activeTab];
  const filteredMediaAssets = (() => {
    let list = mediaAssets;
    if (mediaFolderFilter === 'none') {
      list = list.filter((m: any) => !m.folderId);
    } else {
      list = list.filter((m: any) => m.folderId === mediaFolderFilter);
    }
    const q = mediaSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m: any) => {
      const name = String(m.originalName || '').toLowerCase();
      const url = String(m.url || '').toLowerCase();
      const kind = String(m.kind || '').toLowerCase();
      const folderName = String(m.folder?.name || '').toLowerCase();
      return name.includes(q) || url.includes(q) || kind.includes(q) || folderName.includes(q);
    });
  })();

  return (
    <div className="admin-dashboard-wrapper">
      {managingAccessFor && (
        <div className="admin-modal-overlay">
          <div className="admin-modal admin-modal--client-licenses">
            <h2 className="admin-modal-client-title">Cliente e licenças</h2>
            <p className="admin-modal-meta">
              <strong>{managingAccessFor.email}</strong>
              {managingAccessFor.name ? (
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> — {managingAccessFor.name}</span>
              ) : null}
            </p>
            <p className="admin-modal-lead">
              O acesso às <strong>trilhas EAD</strong> segue os cursos publicados no painel. As licenças abaixo valem para o robô / EA: o{' '}
              <strong>código da oferta Hotmart</strong> (cadastrado em Produtos) define produto e plano. Cada <strong>compra</strong> gera uma licença; uma nova compra do mesmo produto gera outra licença. No cadastro manual, use o systemId completo do produto (todos os IDs do EA, separados por vírgula) — não crie uma licença por ID. A{' '}
              <strong>data de expiração só começa a contar na primeira validação</strong> do robô no gráfico — antes disso a licença fica ativa sem prazo em curso.
            </p>

            <div className="admin-modal-license-list-block">
              <h3 className="admin-modal-section-title">
                Licenças deste e-mail ({licensesForClientModal.length})
                {modalLicensesLoading ? ' — carregando…' : ''}
              </h3>
              <div className="admin-modal-license-table-wrap">
                <table className="admin-table admin-table--client-licenses" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>systemId</th>
                      <th>Produto</th>
                      <th>Plano</th>
                      <th>Nº conta MT5</th>
                      <th>Status</th>
                      <th>Expira</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {modalLicensesLoading ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 13 }}>
                          Carregando licenças…
                        </td>
                      </tr>
                    ) : licensesForClientModal.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 13 }}>
                          Nenhuma licença para este e-mail. Crie uma abaixo informando o systemId.
                        </td>
                      </tr>
                    ) : (
                      licensesForClientModal.map((l: any) => (
                        <tr key={l.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{l.id}</td>
                          <td>
                            <code style={{ fontSize: 12 }}>{l.systemId || '—'}</code>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{productNameByLicense(l)}</td>
                          <td>{l.plano || '—'}</td>
                          <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                            {String(l.numeroConta || '').trim() || '—'}
                          </td>
                          <td>
                            {(() => {
                              const st = effectiveLicenseStatus(l.statusLicenca, l.dataExpiracao);
                              return (
                                <span className={`admin-license-status-pill admin-license-status-pill--${licenseStatusPillClass(st)}`}>
                                  {st}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {l.dataExpiracao
                              ? new Date(l.dataExpiracao).toLocaleDateString('pt-BR')
                              : effectiveLicenseStatus(l.statusLicenca, l.dataExpiracao) === 'ativa'
                                ? 'Aguardando 1ª validação EA'
                                : '—'}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                            <div className="admin-modal-license-table-actions">
                            <button
                              type="button"
                              className="btn-primary"
                              style={{ fontSize: 11, padding: '4px 10px' }}
                              disabled={licenseModalBusy}
                              onClick={() => {
                                setEditingLicenseId(l.id);
                                setLicenseForm({
                                  systemId: String(l.systemId || ''),
                                  plano: String(l.plano || 'mensal'),
                                  statusLicenca: String(l.statusLicenca || 'ativa'),
                                  dataExpiracao: isoToDatetimeLocalValue(l.dataExpiracao),
                                  numeroConta: String(l.numeroConta || ''),
                                  offerCode: String(l.offerCode || ''),
                                });
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn-danger-sm"
                              disabled={licenseModalBusy}
                              onClick={async () => {
                                if (!window.confirm('Excluir esta licença?')) return;
                                setLicenseModalBusy(true);
                                try {
                                  const res = await fetch(`/api/admin/licenses/${l.id}`, {
                                    method: 'DELETE',
                                    headers: { ...authHeaders() },
                                  });
                                  if (!res.ok) alert('Erro ao excluir.');
                                  else refreshLicensesAfterModalChange();
                                } finally {
                                  setLicenseModalBusy(false);
                                }
                              }}
                            >
                              Excluir
                            </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-modal-license-panel">
              <h3 className="admin-modal-section-title admin-modal-section-title--panel">
                {editingLicenseId != null ? `Editar licença #${editingLicenseId}` : 'Nova licença'}
              </h3>
              <label className="admin-modal-field-label" htmlFor="license-product-pick">
                Produto vinculado
              </label>
              <select
                id="license-product-pick"
                value={licenseFormSelectedProductId}
                disabled={licenseModalBusy}
                onChange={(e) => {
                  const productId = e.target.value;
                  if (!productId) return;
                  const p = (products as Array<{ id: number; systemId?: string; plano?: string; offerCode?: string }>).find(
                    (x) => String(x.id) === productId
                  );
                  if (!p) return;
                  const firstOffer =
                    String(p.offerCode || '')
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)[0] || '';
                  setLicenseForm((f) => ({
                    ...f,
                    systemId: String(p.systemId || '').trim(),
                    plano: String(p.plano || f.plano || 'mensal'),
                    offerCode: firstOffer || f.offerCode,
                  }));
                }}
              >
                <option value="">Selecione um produto…</option>
                {products.map((p: any) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.productName} — {p.systemId}
                  </option>
                ))}
              </select>
              {licenseFormSelectedProductName ? (
                <p className="admin-modal-field-hint" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
                  Detectado: <strong>{licenseFormSelectedProductName}</strong>
                  {licenseForm.systemId ? (
                    <>
                      {' '}
                      · systemId <code>{licenseForm.systemId}</code>
                    </>
                  ) : null}
                </p>
              ) : licenseForm.systemId.trim() ? (
                <p className="admin-modal-field-hint" style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: '#f59e0b' }}>
                  Nenhum produto do catálogo corresponde a este systemId/plano. Confira em Produtos.
                </p>
              ) : null}
              <label className="admin-modal-field-label" htmlFor="license-system-id">
                systemId *
              </label>
              <input
                id="license-system-id"
                value={licenseForm.systemId}
                onChange={(e) => setLicenseForm((f) => ({ ...f, systemId: e.target.value }))}
                placeholder="Mesmo valor cadastrado em Produtos"
                disabled={licenseModalBusy}
                autoComplete="off"
              />
              <div className="admin-modal-license-grid-2">
                <div className="admin-modal-license-field">
                  <label className="admin-modal-field-label" htmlFor="license-plano">
                    Plano
                  </label>
                  <select
                    id="license-plano"
                    value={licenseForm.plano}
                    onChange={(e) =>
                      setLicenseForm((f) => ({
                        ...f,
                        plano: e.target.value,
                        dataExpiracao: planExpiryLocalValue(e.target.value),
                      }))
                    }
                    disabled={licenseModalBusy}
                  >
                    {licenseForm.plano && !PLAN_OPTIONS.includes(licenseForm.plano as (typeof PLAN_OPTIONS)[number]) && (
                      <option value={licenseForm.plano}>{licenseForm.plano}</option>
                    )}
                    {PLAN_OPTIONS.map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-modal-license-field">
                  <label className="admin-modal-field-label" htmlFor="license-status">
                    Status
                  </label>
                  <select
                    id="license-status"
                    value={licenseForm.statusLicenca}
                    onChange={(e) => setLicenseForm((f) => ({ ...f, statusLicenca: e.target.value }))}
                    disabled={licenseModalBusy}
                  >
                    <option value="ativa">ativa</option>
                    <option value="inativa">inativa</option>
                    <option value="expirada">expirada</option>
                  </select>
                </div>
              </div>
              <label className="admin-modal-field-label" htmlFor="license-expires">
                Data de expiração
              </label>
              <input
                id="license-expires"
                type="datetime-local"
                value={licenseForm.dataExpiracao}
                onChange={(e) => setLicenseForm((f) => ({ ...f, dataExpiracao: e.target.value }))}
                disabled={licenseModalBusy}
              />
              <p className="admin-modal-field-hint" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>
                Normalmente o prazo começa na 1ª validação do EA. Você pode ajustar manualmente aqui (deixe vazio para remover a data).
              </p>
              <label className="admin-modal-field-label" htmlFor="license-mt5">
                Nº conta MT5 (opcional)
              </label>
              <input
                id="license-mt5"
                value={licenseForm.numeroConta}
                onChange={(e) => setLicenseForm((f) => ({ ...f, numeroConta: e.target.value }))}
                disabled={licenseModalBusy}
                autoComplete="off"
              />
              <div className="admin-modal-license-actions">
                {editingLicenseId != null ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={licenseModalBusy || !licenseForm.systemId.trim()}
                      onClick={async () => {
                        setLicenseModalBusy(true);
                        try {
                          const res = await fetch(`/api/admin/licenses/${editingLicenseId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', ...authHeaders() },
                            body: JSON.stringify({
                              email: managingAccessFor.email,
                              buyerName: managingAccessFor.name || null,
                              systemId: licenseForm.systemId.trim(),
                              plano: licenseForm.plano,
                              statusLicenca: licenseForm.statusLicenca,
                              dataExpiracao: datetimeLocalToIsoOrNull(licenseForm.dataExpiracao),
                              numeroConta: licenseForm.numeroConta.trim(),
                              offerCode: licenseForm.offerCode.trim() || null,
                            }),
                          });
                          if (!res.ok) alert('Falha ao atualizar licença.');
                          else {
                            refreshLicensesAfterModalChange();
                            setEditingLicenseId(null);
                            setLicenseForm({
                              systemId: '',
                              plano: 'mensal',
                              statusLicenca: 'ativa',
                              dataExpiracao: planExpiryLocalValue('mensal'),
                              numeroConta: '',
                              offerCode: '',
                            });
                          }
                        } finally {
                          setLicenseModalBusy(false);
                        }
                      }}
                    >
                      {licenseModalBusy ? 'Salvando…' : 'Salvar alterações'}
                    </button>
                    <button
                      type="button"
                      className="btn-cancel"
                      disabled={licenseModalBusy}
                      onClick={() => {
                        setEditingLicenseId(null);
                        setLicenseForm({
                          systemId: '',
                          plano: 'mensal',
                          statusLicenca: 'ativa',
                          dataExpiracao: planExpiryLocalValue('mensal'),
                          numeroConta: '',
                          offerCode: '',
                        });
                      }}
                    >
                      Cancelar edição
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={licenseModalBusy || !licenseForm.systemId.trim()}
                    onClick={async () => {
                      setLicenseModalBusy(true);
                      try {
                        const res = await fetch('/api/admin/licenses', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...authHeaders() },
                          body: JSON.stringify({
                            email: managingAccessFor.email,
                            buyerName: managingAccessFor.name || null,
                            systemId: licenseForm.systemId.trim(),
                            plano: licenseForm.plano,
                            statusLicenca: licenseForm.statusLicenca,
                            dataExpiracao: datetimeLocalToIsoOrNull(licenseForm.dataExpiracao),
                            numeroConta: licenseForm.numeroConta.trim(),
                            offerCode: licenseForm.offerCode.trim() || null,
                          }),
                        });
                        if (!res.ok) alert('Falha ao criar licença.');
                        else {
                          refreshLicensesAfterModalChange();
                          setLicenseForm({
                            systemId: '',
                            plano: 'mensal',
                            statusLicenca: 'ativa',
                            dataExpiracao: planExpiryLocalValue('mensal'),
                            numeroConta: '',
                            offerCode: '',
                          });
                        }
                      } finally {
                        setLicenseModalBusy(false);
                      }
                    }}
                  >
                    {licenseModalBusy ? 'Salvando…' : 'Adicionar licença'}
                  </button>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button type="button" className="btn-cancel" onClick={() => setManagingAccessFor(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="admin-shell">
        <aside className="admin-sidebar" aria-label="Menu do painel administrativo">
          <div className="admin-sidebar-brand">
            <img src="/autofintech-logo.png" alt="AutoFinTech" className="admin-sidebar-logo" draggable={false} />
            <span className="admin-sidebar-badge">Painel</span>
          </div>
          <nav className="admin-sidebar-nav">
            <button type="button" className={`admin-sidebar-item ${activeTab === 'courses' ? 'active' : ''}`} onClick={() => setActiveTab('courses')}>
              <GraduationCap size={20} aria-hidden />
              <span>Cursos EAD</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'banner' ? 'active' : ''}`} onClick={() => setActiveTab('banner')}>
              <Images size={20} aria-hidden />
              <span>Banner início</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
              <Users size={20} aria-hidden />
              <span>Clientes</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'webhooks' ? 'active' : ''}`} onClick={() => setActiveTab('webhooks')}>
              <Webhook size={20} aria-hidden />
              <span>Webhook</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'email' ? 'active' : ''}`} onClick={() => setActiveTab('email')}>
              <Mail size={20} aria-hidden />
              <span>E-mail</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}>
              <Layers size={20} aria-hidden />
              <span>Produtos</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'links' ? 'active' : ''}`} onClick={() => setActiveTab('links')}>
              <Link2 size={20} aria-hidden />
              <span>WP Links</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'media' ? 'active' : ''}`} onClick={() => setActiveTab('media')}>
              <FolderOpen size={20} aria-hidden />
              <span>Mídia</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'support' ? 'active' : ''}`} onClick={() => setActiveTab('support')}>
              <LifeBuoy size={20} aria-hidden />
              <span>Suporte</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'builder' ? 'active' : ''}`} onClick={() => setActiveTab('builder')}>
              <Code2 size={20} aria-hidden />
              <span>Construtor HTML</span>
            </button>
            <button type="button" className={`admin-sidebar-item ${activeTab === 'forexEA' ? 'active' : ''}`} onClick={() => setActiveTab('forexEA')}>
              <Key size={20} aria-hidden />
              <span>Segurança EA</span>
            </button>
          </nav>
          <div className="admin-sidebar-footer">
            <button
              type="button"
              className="admin-sidebar-logout"
              onClick={() => {
                localStorage.removeItem(ADMIN_JWT_KEY);
                localStorage.removeItem('adminToken');
                sessionStorage.removeItem(ADMIN_UI_KEY);
                window.location.href = '/admin';
              }}
            >
              Sair
            </button>
          </div>
        </aside>

        <div className={`admin-main admin-main--${activeTab}`}>
      <section className="admin-page-hero" aria-label="Resumo da seção">
        <h1>{currentAdminMeta?.title || 'Painel'}</h1>
        <p>{currentAdminMeta?.subtitle || 'Gerencie sua operação com rapidez.'}</p>
      </section>
      {activeTab === 'banner' && (
        <div className="admin-content admin-content--stack">
          <div className="admin-form">
            <h2>Banner da página inicial</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.55 }}>
              O destaque no início da área do membro mostra o selo e as boas-vindas. Se a URL da imagem estiver vazia, o sistema usa a <strong>capa do primeiro curso publicado</strong> (com imagem) como fundo do banner — ideal para o fluxo EAD.
            </p>
            <label style={{ display: 'block', marginTop: '14px', marginBottom: '6px', fontWeight: 600 }}>URL da imagem de fundo (opcional)</label>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '-2px', marginBottom: '8px', lineHeight: 1.5 }}>
              A imagem preenche a largura inteira (modo cover). Use arte <strong>panorâmica</strong> (~<strong>3,5:1 a 4,5:1</strong>), ex.{' '}
              <strong>2560×640</strong> ou <strong>2880×720</strong>. Mantenha rosto, logo e textos no <strong>centro</strong> (as bordas podem
              ser levemente cortadas). A base do banner recebe degradê automático até o fundo da página.
            </p>
            <input
              type="url"
              placeholder="https://… ou /api/public/media/…/file"
              value={emailSettings.member_hero_background_url || ''}
              onChange={(e) => setEmailSettings((p) => ({ ...p, member_hero_background_url: e.target.value }))}
              style={{ width: '100%', padding: '10px', marginBottom: '14px' }}
            />
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>Texto do selo acima do nome (opcional)</label>
            <input
              type="text"
              placeholder="Ex.: Acesso exclusivo"
              value={emailSettings.member_hero_kicker || ''}
              onChange={(e) => setEmailSettings((p) => ({ ...p, member_hero_kicker: e.target.value }))}
              style={{ width: '100%', padding: '10px', marginBottom: '16px' }}
            />
            <button type="button" className="btn-primary" onClick={() => void saveMemberBanner()} disabled={bannerSaving}>
              {bannerSaving ? 'Salvando…' : 'Salvar banner'}
            </button>
          </div>
          <div className="admin-form">
            <h2>Tema da área de membros</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.55 }}>
              Personalize as cores globais da área de membros (menu, páginas, cards, botões e player de vídeo nas aulas). Essas cores são aplicadas em toda a experiência do aluno.
            </p>
            <div className="admin-theme-colors-grid">
              {MEMBER_THEME_COLOR_FIELDS.map(({ key, label }) => {
                const fallback = MEMBER_THEME_DEFAULTS[key];
                const color = hexForColorInput(emailSettings[key], fallback);
                return (
                  <label key={key} className="admin-theme-color-field">
                    {label}
                    <div className="admin-theme-color-row">
                      <span
                        className="admin-theme-color-swatch"
                        style={{ backgroundColor: color }}
                        title={color}
                        aria-hidden
                      />
                      <input
                        type="color"
                        className="admin-theme-color-input"
                        value={color}
                        onChange={(e) => setEmailSettings((p) => ({ ...p, [key]: e.target.value }))}
                        aria-label={label}
                      />
                      <code className="admin-theme-color-hex">{color}</code>
                    </div>
                  </label>
                );
              })}
              <label className="admin-theme-color-field" style={{ gridColumn: '1 / -1', textTransform: 'none' }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>
                  Borda sutil (RGBA)
                </span>
                <input
                  type="text"
                  placeholder="rgba(255, 255, 255, 0.12)"
                  value={emailSettings.member_theme_border_subtle || 'rgba(255, 255, 255, 0.12)'}
                  onChange={(e) => setEmailSettings((p) => ({ ...p, member_theme_border_subtle: e.target.value }))}
                />
              </label>
            </div>
            <div className="admin-form-actions" style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={() => void saveMemberTheme()} disabled={themeSaving}>
                {themeSaving ? 'Salvando…' : 'Salvar tema da área de membros'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void resetMemberTheme()} disabled={themeSaving}>
                Restaurar cores padrão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB: COURSES (EAD) --- */}
      {activeTab === 'courses' && (
        <div className="admin-content admin-content--stack admin-ead-tab-root">
          <div className="admin-ead-shell">
            <aside className="admin-ead-tree-col" aria-label="Estrutura dos cursos">
              <div className="admin-ead-tree-head">
                <h3 className="admin-ead-tree-title">Estrutura</h3>
                <button type="button" className="btn-secondary" onClick={() => fetchCourses()} title="Atualizar lista">
                  <RefreshCw size={14} />
                </button>
              </div>
              <p className="admin-ead-tree-hint">Selecione curso, módulo e aula. O painel à direita muda conforme a aba.</p>
              {courses.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Nenhum curso criado ainda.</p>
              ) : (
                <div className="admin-course-tree admin-course-tree--scroll">
                  {courses.map((c: any) => {
                    const isSelected = selectedCourseId === c.id;
                    return (
                      <div key={c.id} className={`admin-course-node ${isSelected ? 'admin-course-node--active' : ''}`}>
                        <button
                          type="button"
                          className="admin-course-node-header"
                          onClick={() => {
                            setSelectedCourseId(isSelected ? '' : c.id);
                            setSelectedModuleId('');
                            setSelectedLessonId('');
                            if (!isSelected) setEadSectionTab('curso');
                          }}
                        >
                          <GraduationCap size={16} />
                          <span style={{ fontWeight: 700, flex: 1 }}>{c.title}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {(c.modules || []).length} mód · {(c.modules || []).reduce((a: number, m: any) => a + (m.lessons?.length || 0), 0)} aulas
                          </span>
                        </button>

                        {isSelected &&
                          (c.modules || []).map((m: any) => {
                            const isMod = selectedModuleId === m.id;
                            return (
                              <div key={m.id} className="admin-module-node">
                                <button
                                  type="button"
                                  className={`admin-module-node-header ${isMod ? 'admin-module-node-header--active' : ''}`}
                                  onClick={() => {
                                    setSelectedModuleId(isMod ? '' : m.id);
                                    setSelectedLessonId('');
                                    if (!isMod) {
                                      setEadSectionTab('modulo');
                                      setEadLessonSubtab('nova');
                                    }
                                  }}
                                >
                                  <Layers size={14} />
                                  <span style={{ flex: 1 }}>{m.title}</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{(m.lessons || []).length} aulas</span>
                                </button>

                                {isMod && (
                                  <ul className="admin-lesson-list">
                                    {(m.lessons || []).length === 0 ? (
                                      <li className="admin-lesson-item admin-lesson-item--muted">Nenhuma aula neste módulo.</li>
                                    ) : (
                                      (m.lessons || []).map((l: any, idx: number) => {
                                        const activeLesson = selectedLessonId === l.id;
                                        const overBefore = dragOverModuleId === m.id && dragOverInsertIndex === idx;
                                        const overAfter = dragOverModuleId === m.id && dragOverInsertIndex === idx + 1;
                                        return (
                                          <React.Fragment key={l.id}>
                                            <li
                                              className={`admin-lesson-dropzone admin-lesson-dropzone--between ${overBefore ? 'admin-lesson-dropzone--active' : ''}`}
                                              onDragOver={(e) => {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = 'move';
                                                if (draggedLessonId) {
                                                  setDragOverModuleId(m.id);
                                                  setDragOverInsertIndex(idx);
                                                }
                                              }}
                                              onDrop={(e) => {
                                                e.preventDefault();
                                                void moveLessonToTarget(m.id, idx);
                                              }}
                                            >
                                              Soltar aqui (posição {idx + 1})
                                            </li>
                                            <li>
                                              <button
                                                type="button"
                                                data-allow-drag="true"
                                                className={`admin-lesson-item admin-lesson-item--btn ${activeLesson ? 'admin-lesson-item--active' : ''}`}
                                                draggable
                                                onDragStart={(e) => {
                                                  e.dataTransfer.effectAllowed = 'move';
                                                  setDraggedLessonId(l.id);
                                                  setDragOverModuleId(m.id);
                                                  setDragOverInsertIndex(idx);
                                                }}
                                                onDragEnd={() => {
                                                  setDraggedLessonId('');
                                                  setDragOverModuleId('');
                                                  setDragOverInsertIndex(null);
                                                }}
                                                onClick={() => {
                                                  setSelectedLessonId(activeLesson ? '' : l.id);
                                                  if (!activeLesson) {
                                                    setEadSectionTab('aula');
                                                    setEadLessonSubtab('editar');
                                                  }
                                                }}
                                              >
                                                <ListChecks size={12} />
                                                <span>{l.title}</span>
                                                {l.videoUrl && (
                                                  <span style={{ fontSize: 10, color: 'var(--accent-primary)', marginLeft: 'auto' }}>vídeo</span>
                                                )}
                                              </button>
                                            </li>
                                            {idx === (m.lessons || []).length - 1 && (
                                              <li
                                                className={`admin-lesson-dropzone admin-lesson-dropzone--between ${overAfter ? 'admin-lesson-dropzone--active' : ''}`}
                                                onDragOver={(e) => {
                                                  e.preventDefault();
                                                  e.dataTransfer.dropEffect = 'move';
                                                  if (draggedLessonId) {
                                                    setDragOverModuleId(m.id);
                                                    setDragOverInsertIndex(idx + 1);
                                                  }
                                                }}
                                                onDrop={(e) => {
                                                  e.preventDefault();
                                                  void moveLessonToTarget(m.id, idx + 1);
                                                }}
                                              >
                                                Soltar aqui (posição {idx + 2})
                                              </li>
                                            )}
                                          </React.Fragment>
                                        );
                                      })
                                    )}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>

            <div className="admin-ead-editor-col">
              <div className="admin-ead-main-tabs" role="tablist" aria-label="Editor EAD">
                {(['curso', 'modulo', 'aula'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={eadSectionTab === tab}
                    className={`admin-ead-main-tab ${eadSectionTab === tab ? 'admin-ead-main-tab--active' : ''}`}
                    onClick={() => setEadSectionTab(tab)}
                  >
                    {tab === 'curso' ? 'Curso' : tab === 'modulo' ? 'Módulos' : 'Aulas'}
                  </button>
                ))}
              </div>

              {eadSectionTab === 'curso' && (
                <div className="admin-ead-panel">
                  {selectedCourseId && selectedCourse ? (
                    <div className="admin-form">
                      <h3>
                        <Pencil size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Curso selecionado
                      </h3>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        A capa aparece no banner da home se não houver imagem fixa em &quot;Banner início&quot;.
                      </p>
                      <label>Título *</label>
                      <input value={editCourseTitle} onChange={(e) => setEditCourseTitle(e.target.value)} />
                      <label>Slug (URL) *</label>
                      <input value={editCourseSlug} onChange={(e) => setEditCourseSlug(e.target.value)} />
                      <label>Nova capa (opcional)</label>
                      <input type="file" accept="image/*" onChange={(e) => setEditCourseCoverFile(e.target?.files?.[0] || null)} />

                      <label style={{ marginTop: 12 }}>Produtos com acesso a este curso</label>
                      {renderProductPicker(editCourseProductIds, setEditCourseProductIds)}
                      <small style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
                        Clique nos produtos abaixo para liberar este curso. Apenas usuários com licença ativa para a combinação <strong>system_id + código da oferta</strong> daquele produto verão o conteúdo. Sem produtos = curso público.
                      </small>

                      <label style={{ marginTop: 12 }}>Link da página de vendas (para quem não tem acesso)</label>
                      <input
                        placeholder="https://seu-dominio.com/oferta"
                        value={editCourseSalesPageUrl}
                        onChange={(e) => setEditCourseSalesPageUrl(e.target.value)}
                      />
                      <small style={{ color: 'var(--text-secondary)' }}>
                        Usado quando um aluno sem licença clicar no card bloqueado deste curso.
                      </small>

                      <label style={{ marginTop: 12 }}>Link para quem tem acesso (opcional)</label>
                      <input
                        placeholder="https://chat.whatsapp.com/..."
                        value={editCourseMemberPageUrl}
                        onChange={(e) => setEditCourseMemberPageUrl(e.target.value)}
                      />
                      <small style={{ color: 'var(--text-secondary)' }}>
                        Se preenchido, o card abre este link em vez do EAD — útil para WhatsApp de suporte sem módulos/aulas.
                      </small>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                        <input type="checkbox" checked={editCoursePublished} onChange={(e) => setEditCoursePublished(e.target.checked)} />
                        Curso publicado (visível para alunos)
                      </label>
                      <div className="admin-form-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <button type="button" className="btn-primary" onClick={() => void handleSaveCourse()}>
                          Salvar alterações do curso
                        </button>
                        <button type="button" className="btn-danger-sm" onClick={() => void handleDeleteCourse()}>
                          Excluir curso
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setSelectedCourseId('');
                            setSelectedModuleId('');
                            setSelectedLessonId('');
                          }}
                        >
                          Desmarcar e criar novo curso
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="admin-ead-placeholder">Selecione um curso na coluna &quot;Estrutura&quot; para editar título, slug e publicação.</p>
                  )}

                  {!selectedCourseId && (
                    <form className="admin-form" onSubmit={handleCreateCourse}>
                      <h3>
                        <GraduationCap size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Criar novo curso
                      </h3>
                      <label>Imagem do card (capa)</label>
                      <input type="file" accept="image/*" onChange={(e) => setNewCourseCoverFile(e.target?.files?.[0] || null)} />
                      <label>Título *</label>
                      <input placeholder="Ex: Formação Robô Forex" value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} required />
                      <label>Slug (URL)</label>
                      <input placeholder="Auto se vazio" value={newCourseSlug} onChange={(e) => setNewCourseSlug(e.target.value)} />

                      <label style={{ marginTop: 12 }}>Produtos com acesso a este curso</label>
                      {renderProductPicker(newCourseProductIds, setNewCourseProductIds)}
                      <small style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
                        Clique nos produtos abaixo para liberar este curso. Apenas usuários com licença ativa para a combinação <strong>system_id + código da oferta</strong> daquele produto verão o conteúdo. Sem produtos = curso público.
                      </small>

                      <label style={{ marginTop: 12 }}>Link da página de vendas (para quem não tem acesso)</label>
                      <input
                        placeholder="https://seu-dominio.com/oferta"
                        value={newCourseSalesPageUrl}
                        onChange={(e) => setNewCourseSalesPageUrl(e.target.value)}
                      />
                      <small style={{ color: 'var(--text-secondary)' }}>
                        Quando um aluno sem acesso clicar no card deste curso, ele será redirecionado para este link.
                      </small>

                      <label style={{ marginTop: 12 }}>Link para quem tem acesso (opcional)</label>
                      <input
                        placeholder="https://chat.whatsapp.com/..."
                        value={newCourseMemberPageUrl}
                        onChange={(e) => setNewCourseMemberPageUrl(e.target.value)}
                      />
                      <small style={{ color: 'var(--text-secondary)' }}>
                        Se preenchido, o card abre este link em vez do EAD — útil para WhatsApp de suporte sem módulos/aulas.
                      </small>

                      <div className="admin-form-actions" style={{ marginTop: 12 }}>
                        <button type="submit">Criar curso</button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {eadSectionTab === 'modulo' && (
                <div className="admin-ead-panel">
                  {selectedCourseId ? (
                    <>
                      <form className="admin-form" onSubmit={handleCreateModule}>
                        <h3>
                          <Layers size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Novo módulo
                        </h3>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          Dentro de: <strong>{selectedCourse?.title}</strong>
                        </p>
                        <label>Título *</label>
                        <input placeholder="Ex: Primeiros passos" value={newModuleTitle} onChange={(e) => setNewModuleTitle(e.target.value)} required />
                        <div className="admin-form-actions">
                          <button type="submit">Criar módulo</button>
                        </div>
                      </form>

                      {selectedModuleId ? (
                        <div className="admin-form">
                          <h3>
                            <Layers size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Editar módulo
                          </h3>
                          <label>Título do módulo *</label>
                          <input value={editModuleTitle} onChange={(e) => setEditModuleTitle(e.target.value)} />
                          <div className="admin-form-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <button type="button" className="btn-primary" onClick={() => void handleSaveModule()}>
                              Salvar módulo
                            </button>
                            <button type="button" className="btn-danger-sm" onClick={() => void handleDeleteModule()}>
                              Excluir módulo
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="admin-ead-placeholder">Selecione um módulo na árvore para renomear ou excluir.</p>
                      )}
                    </>
                  ) : (
                    <p className="admin-ead-placeholder">Selecione um curso na árvore para gerenciar módulos.</p>
                  )}
                </div>
              )}

              {eadSectionTab === 'aula' && (
                <div className="admin-ead-panel">
                  <div className="admin-ead-subtabs" role="tablist" aria-label="Aulas">
                    <button
                      type="button"
                      role="tab"
                      className={`admin-ead-subtab ${eadLessonSubtab === 'nova' ? 'admin-ead-subtab--active' : ''}`}
                      aria-selected={eadLessonSubtab === 'nova'}
                      onClick={() => setEadLessonSubtab('nova')}
                    >
                      Nova aula
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={`admin-ead-subtab ${eadLessonSubtab === 'editar' ? 'admin-ead-subtab--active' : ''}`}
                      aria-selected={eadLessonSubtab === 'editar'}
                      onClick={() => setEadLessonSubtab('editar')}
                    >
                      Editar aula
                    </button>
                  </div>

                  {eadLessonSubtab === 'nova' && (
                    <>
                      {selectedModuleId ? (
                        <form className="admin-form" onSubmit={handleCreateLesson}>
                          <h3>
                            <ListChecks size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Nova aula
                          </h3>
                          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            Módulo: <strong>{selectedModules.find((m: any) => m.id === selectedModuleId)?.title}</strong>
                          </p>
                          <label>Título *</label>
                          <input placeholder="Ex: Como instalar o robô" value={newLessonTitle} onChange={(e) => setNewLessonTitle(e.target.value)} required />
                          <label>Link do vídeo</label>
                          <input placeholder="Link do YouTube (watch ou youtu.be) ou embed" value={newLessonVideoUrl} onChange={(e) => setNewLessonVideoUrl(e.target.value)} />
                          <label>Texto da aula</label>
                          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                            Selecione trechos para negrito, itálico, cor ou link (menu interno ou URL em nova guia).
                          </p>
                          <LessonRichTextEditor
                            value={newLessonBodyText}
                            onChange={setNewLessonBodyText}
                            placeholder="Conteúdo da aula…"
                            minHeight={140}
                          />
                          <label>Texto do botão</label>
                          <input placeholder="Ex: Baixar arquivos" value={newLessonActionLabel} onChange={(e) => setNewLessonActionLabel(e.target.value)} />
                          <label>Link do botão</label>
                          <input placeholder="https://..." value={newLessonActionUrl} onChange={(e) => setNewLessonActionUrl(e.target.value)} />
                          <div className="admin-form-actions">
                            <button type="submit">Criar aula</button>
                          </div>
                        </form>
                      ) : (
                        <p className="admin-ead-placeholder">Selecione um módulo na árvore para adicionar uma nova aula.</p>
                      )}
                    </>
                  )}

                  {eadLessonSubtab === 'editar' && (
                    <>
                      {selectedLessonId ? (
                        <div className="admin-form">
                          <h3>
                            <ListChecks size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Editar aula publicada
                          </h3>
                          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            Alterações valem para todos os alunos assim que você salvar. Curso pode continuar publicado.
                          </p>
                          <label>Título *</label>
                          <input value={editLessonTitle} onChange={(e) => setEditLessonTitle(e.target.value)} />
                          <label>Link do vídeo</label>
                          <input value={editLessonVideoUrl} onChange={(e) => setEditLessonVideoUrl(e.target.value)} />
                          <label>Texto da aula</label>
                          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                            Selecione trechos para negrito, itálico, cor ou link (menu interno ou URL em nova guia).
                          </p>
                          <LessonRichTextEditor
                            value={editLessonBodyText}
                            onChange={setEditLessonBodyText}
                            minHeight={180}
                          />
                          <label>Texto do botão</label>
                          <input value={editLessonActionLabel} onChange={(e) => setEditLessonActionLabel(e.target.value)} />
                          <label>Link do botão</label>
                          <input value={editLessonActionUrl} onChange={(e) => setEditLessonActionUrl(e.target.value)} />
                          <div className="admin-form-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <button type="button" className="btn-primary" onClick={() => void handleSaveLesson()}>
                              Salvar aula
                            </button>
                            <button type="button" className="btn-danger-sm" onClick={() => void handleDeleteLesson()}>
                              Excluir aula
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="admin-ead-placeholder">Clique em uma aula na árvore ou use a aba &quot;Nova aula&quot; para criar.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- TAB: USERS --- */}
      {activeTab === 'users' && (
        <div className="admin-content admin-content--stack">
          {/* Stats Row */}
          <div className="admin-stats-row">
            <div className="admin-stat-card">
              <div><div className="stat-number">{mergedClients.length}</div><div className="stat-label">Clientes</div></div>
            </div>
            <div className="admin-stat-card">
              <div>
                <div className="stat-number">{licenseCounters.ativas}</div>
                <div className="stat-label">Licenças ativas</div>
              </div>
            </div>
            <div className="admin-stat-card">
              <div><div className="stat-number">{licenseCounters.desativadas}</div><div className="stat-label">Licenças desativadas</div></div>
            </div>
            <div className="admin-stat-card">
              <div><div className="stat-number">{licenseCounters.testesAtivos}</div><div className="stat-label">Testes ativos</div></div>
            </div>
          </div>

          <form className="admin-form admin-form--client-create" onSubmit={handleCreateUser}>
              <h3><UserPlus size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }}/>Cadastrar Usuário</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Cadastro manual já cria o cliente e a licença ativa com o produto/plano escolhido.
              </p>
              <div className="admin-client-create-grid">
                <div className="admin-client-create-field admin-client-create-field--name">
                  <label>Nome</label>
                  <input type="text" placeholder="Nome do cliente" value={newUserName} onChange={e => setNewUserName(e.target.value)} />
                </div>
                <div className="admin-client-create-field admin-client-create-field--email">
                  <label>E-mail *</label>
                  <input type="email" placeholder="email@aluno.com" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} required />
                </div>
                <div className="admin-client-create-field admin-client-create-field--password">
                  <label>Senha Provisória *</label>
                  <input type="text" placeholder="Senha123" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} required />
                </div>
                <div className="admin-client-create-field admin-client-create-field--product">
                  <label>Produto *</label>
                  <select value={newUserProductId} onChange={(e) => setNewUserProductId(e.target.value)} required>
                    <option value="">Selecione um produto…</option>
                    {products.map((p: any) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.productName} — {p.systemId}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-client-create-field admin-client-create-field--plan">
                  <label>Plano *</label>
                  <select value={newUserPlan} onChange={(e) => setNewUserPlan(e.target.value)} required>
                    {PLAN_OPTIONS.map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-form-actions">
                <button type="submit">Cadastrar cliente + licença</button>
              </div>
          </form>

          <div className="admin-table-container">
              <h3 style={{ margin: '0 0 12px' }}>Clientes ({filteredUsers.length})</h3>
              <div className="admin-search-bar">
                <Search size={16} className="admin-search-icon" />
                <input
                  type="text"
                  placeholder="Buscar por e-mail ou nome..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                />
              </div>
              <div className="admin-clients-filters">
                <div className="admin-clients-filters-group">
                  <label htmlFor="client-plan-filter">Plano</label>
                  <select id="client-plan-filter" value={userPlanFilter} onChange={(e) => setUserPlanFilter(e.target.value)}>
                    <option value="todos">Todos os planos</option>
                  {availablePlanFilters.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan}
                    </option>
                  ))}
                  </select>
                </div>
                <div className="admin-clients-filters-group">
                  <label htmlFor="client-status-filter">Status</label>
                  <select id="client-status-filter" value={userStatusFilter} onChange={(e) => setUserStatusFilter(e.target.value)}>
                    <option value="todos">Todos os status</option>
                    <option value="ativa">Ativa</option>
                    <option value="inativa">Inativa</option>
                    <option value="expirada">Expirada</option>
                    <option value="sem_licenca">Sem licença</option>
                  </select>
                </div>
                <div className="admin-clients-filters-group">
                  <label htmlFor="client-sort-filter">Ordenar</label>
                  <select id="client-sort-filter" value={userSort} onChange={(e) => setUserSort(e.target.value as 'newest' | 'oldest')}>
                    <option value="newest">Mais novo</option>
                    <option value="oldest">Mais antigo</option>
                  </select>
                </div>
              </div>
              <div className="admin-table-scroll">
              <table className="admin-table admin-clients-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Licenças (EA)</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((u: any) => (
                    <tr key={u.id}>
                      <td><span style={{ fontWeight: 500 }}>{u.name || <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Sem nome</span>}</span></td>
                      <td>{u.email}</td>
                      <td>
                        {(() => {
                          const n = licenseCountByEmail.get(String(u.email).toLowerCase().trim()) || 0;
                          return (
                            <span
                              style={{
                                background: n > 0 ? 'rgba(59,130,246,0.15)' : 'rgba(158,158,158,0.15)',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: n > 0 ? 'var(--accent-primary)' : '#9e9e9e',
                              }}
                            >
                              {n}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ maxWidth: 280 }}>
                        {(() => {
                          const counts = licenseStatusCountsByEmail.get(String(u.email).toLowerCase().trim());
                          if (!counts || counts.size === 0) {
                            return <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>—</span>;
                          }
                          const parts = Array.from(counts.entries()).sort(([a], [b]) => compareLicenseStatusLabel(a, b));
                          return (
                            <div className="admin-client-license-status-wrap">
                              {parts.map(([st, n]) => (
                                <span
                                  key={st}
                                  className={`admin-license-status-pill admin-license-status-pill--${licenseStatusPillClass(st)}`}
                                  title={n > 1 ? `${n} licenças` : '1 licença'}
                                >
                                  {st}
                                  {n > 1 ? ` ×${n}` : ''}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button className="btn-primary" onClick={() => setManagingAccessFor(u)} style={{ fontSize: '12px', padding: '6px 14px' }}>
                            <KeyRound size={14} /> Licenças
                          </button>
                          <button
                            className="btn-icon btn-danger"
                            onClick={() => handleDeleteUser(u)}
                            title={u._isLicenseOnly ? 'Excluir licenças deste e-mail' : 'Excluir usuário e licenças'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              <AdminPagination page={pageUsers} totalItems={filteredUsers.length} onChange={setPageUsers} />
          </div>

        </div>
      )}

      {activeTab === 'links' && (
        <div className="admin-content admin-content--stack">
          <div className="admin-grid-2">
            <div className="admin-form">
              <h3>{editingShortLinkId ? 'Editar link curto' : 'Novo link curto'}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                Replica o plugin WP Links: slug, URL de destino, UTMs e smart rules (JSON).
              </p>

              <label>Nome interno</label>
              <input
                value={shortLinkForm.name}
                placeholder="Ex.: Campanha Black Friday"
                onChange={(e) => setShortLinkForm((p) => ({ ...p, name: e.target.value }))}
              />

              <label>Slug</label>
              <input
                value={shortLinkForm.slug}
                placeholder="Ex.: go/oferta-exclusiva"
                onChange={(e) => setShortLinkForm((p) => ({ ...p, slug: e.target.value }))}
              />

              <label>URL destino</label>
              <input
                value={shortLinkForm.targetUrl}
                placeholder="https://wa.me/..."
                onChange={(e) => setShortLinkForm((p) => ({ ...p, targetUrl: e.target.value }))}
              />

              <label>Tipo de redirecionamento</label>
              <select
                value={String(shortLinkForm.redirectType)}
                onChange={(e) => setShortLinkForm((p) => ({ ...p, redirectType: Number(e.target.value) || 301 }))}
              >
                <option value="301">301 - Permanente</option>
                <option value="307">307 - Temporário (ofertas)</option>
                <option value="302">302 - Temporário</option>
                <option value="308">308 - Permanente</option>
              </select>

              <label>UTM params (JSON)</label>
              <textarea
                rows={4}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder='{"utm_source":"instagram","src":"bio"}'
                value={shortLinkForm.utmParams}
                onChange={(e) => setShortLinkForm((p) => ({ ...p, utmParams: e.target.value }))}
              />

              <label>Smart rules (JSON)</label>
              <textarea
                rows={5}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder='[{"type":"device","value":"mobile","target":"https://..."}]'
                value={shortLinkForm.smartRules}
                onChange={(e) => setShortLinkForm((p) => ({ ...p, smartRules: e.target.value }))}
              />

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={shortLinkForm.isActive}
                  onChange={(e) => setShortLinkForm((p) => ({ ...p, isActive: e.target.checked }))}
                />
                Ativo
              </label>

              <div className="admin-form-actions">
                {editingShortLinkId != null && (
                  <button type="button" className="btn-cancel" onClick={cancelEditShortLink}>
                    Cancelar edição
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={async () => {
                    const slug = String(shortLinkForm.slug || '').trim();
                    const targetUrl = String(shortLinkForm.targetUrl || '').trim();
                    if (!slug || !targetUrl) {
                      alert('Preencha slug e URL destino.');
                      return;
                    }
                    const payload = {
                      ...shortLinkForm,
                      slug,
                      targetUrl,
                      name: String(shortLinkForm.name || '').trim(),
                      utmParams: String(shortLinkForm.utmParams || '').trim(),
                      smartRules: String(shortLinkForm.smartRules || '').trim(),
                    };
                    const url = editingShortLinkId != null ? `/api/admin/links/${editingShortLinkId}` : '/api/admin/links';
                    const method = editingShortLinkId != null ? 'PUT' : 'POST';
                    const res = await fetch(url, {
                      method,
                      headers: { 'Content-Type': 'application/json', ...authHeaders() },
                      body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                      const j = await res.json().catch(() => ({} as { error?: string }));
                      alert(j.error || 'Falha ao salvar link.');
                      return;
                    }
                    alert(editingShortLinkId != null ? 'Link atualizado.' : 'Link criado.');
                    cancelEditShortLink();
                    void fetchShortLinks();
                  }}
                >
                  {editingShortLinkId != null ? 'Salvar alterações' : 'Criar link'}
                </button>
              </div>
            </div>

            <div className="admin-form">
              <h3>Como usar</h3>
              <ul style={{ paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: 13 }}>
                <li>O link curto final fica em <code>{window.location.origin}/SUA-SLUG</code>.</li>
                <li><code>utmParams</code> aceita JSON de chave/valor e é anexado automaticamente.</li>
                <li><code>smartRules</code> aceita array JSON com regras de <code>device</code> ou <code>geo</code>.</li>
                <li>Regra de exemplo: <code>{'{"type":"device","value":"mobile","target":"https://m.site.com"}'}</code>.</li>
                <li>Você pode importar os dados do WordPress com o script de migração SQL.</li>
              </ul>
            </div>
          </div>

          <div className="admin-table-container admin-table-container--full">
            <h3>Links cadastrados ({shortLinks.length})</h3>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Slug</th>
                    <th>Destino</th>
                    <th>Tipo</th>
                    <th>Cliques</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shortLinks.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                        Nenhum link cadastrado.
                      </td>
                    </tr>
                  ) : (
                    shortLinks.map((link: any) => (
                      <tr key={link.id}>
                        <td>{link.id}</td>
                        <td>{link.name || '—'}</td>
                        <td><code>{link.slug}</code></td>
                        <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={link.targetUrl}>
                          {link.targetUrl}
                        </td>
                        <td>{link.redirectType}</td>
                        <td>{Number(link.clicks || 0).toLocaleString('pt-BR')}</td>
                        <td>
                          <span className={`admin-license-status-pill admin-license-status-pill--${link.isActive ? 'ativa' : 'inativa'}`}>
                            {link.isActive ? 'ativo' : 'inativo'}
                          </span>
                        </td>
                        <td>
                          <div className="admin-actions admin-actions--wrap">
                            <button type="button" className="btn-secondary-sm" onClick={() => startEditShortLink(link)}>
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn-secondary-sm"
                              onClick={() => {
                                const full = `${window.location.origin}/${String(link.slug || '').replace(/^\/+/, '')}`;
                                navigator.clipboard.writeText(full);
                                alert('Link copiado: ' + full);
                              }}
                            >
                              Copiar
                            </button>
                            <button
                              type="button"
                              className="btn-danger-sm"
                              onClick={async () => {
                                if (!window.confirm('Excluir este link?')) return;
                                const res = await fetch(`/api/admin/links/${link.id}`, {
                                  method: 'DELETE',
                                  headers: { ...authHeaders() },
                                });
                                if (!res.ok) {
                                  const j = await res.json().catch(() => ({} as { error?: string }));
                                  alert(j.error || 'Falha ao excluir.');
                                  return;
                                }
                                if (editingShortLinkId === link.id) cancelEditShortLink();
                                void fetchShortLinks();
                              }}
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'media' && (
        <div className="admin-content admin-content--stack">
          <div className="admin-grid-2">
            <div className="admin-form">
              <h3>Upload de mídia</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                Envie imagens, vídeos, áudios e arquivos para gerar links públicos de uso em páginas ou download.
              </p>

              <label>Pasta de destino</label>
              <select
                value={mediaUploadFolderId}
                onChange={(e) => setMediaUploadFolderId(e.target.value)}
              >
                <option value="">Sem pasta (raiz)</option>
                {mediaFolders.map((f: any) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>

              <label>Arquivo</label>
              <input
                type="file"
                accept="image/*,.webp,video/*,audio/*,.pdf,.zip"
                onChange={(e) => setMediaFile(e.target?.files?.[0] || null)}
              />
              {mediaFile && (
                <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Selecionado: <strong>{mediaFile.name}</strong> ({Math.max(1, Math.round(mediaFile.size / 1024))} KB)
                </p>
              )}

              <div className="admin-form-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!mediaFile || mediaUploading}
                  onClick={async () => {
                    if (!mediaFile) return;
                    setMediaUploading(true);
                    try {
                      const form = new FormData();
                      form.append('file', mediaFile);
                      if (mediaUploadFolderId) form.append('folderId', mediaUploadFolderId);
                      const res = await fetch('/api/admin/media', {
                        method: 'POST',
                        headers: { ...authHeaders() },
                        body: form
                      });
                      if (!res.ok) {
                        const j = await res.json().catch(() => ({} as { error?: string }));
                        const fallback =
                          res.status === 502 || res.status === 504
                            ? 'Servidor indisponível (502/504). O app pode estar reiniciando após deploy, ou o proxy precisa encaminhar POST /api ao Node. Aguarde 1 minuto e tente de novo. No EasyPanel: volume em /app/uploads e UPLOAD_DIR=/app/uploads.'
                            : res.status === 413
                              ? 'Arquivo muito grande.'
                              : res.status === 401
                                ? 'Sessão expirada. Faça login novamente.'
                                : `Falha ao enviar mídia (HTTP ${res.status}).`;
                        alert(j.error || fallback);
                        return;
                      }
                      alert('Mídia enviada com sucesso!');
                      setMediaFile(null);
                      void fetchMediaAssets();
                      void fetchMediaFolders();
                    } catch {
                      alert('Erro de conexão no upload.');
                    } finally {
                      setMediaUploading(false);
                    }
                  }}
                >
                  {mediaUploading ? 'Enviando...' : 'Enviar mídia'}
                </button>
              </div>
            </div>

            <div className="admin-form">
              <h3>Como usar os links</h3>
              <ul style={{ paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: 13 }}>
                <li><strong>Link direto:</strong> abre o arquivo via API (<code>/api/public/media/…/file</code>) — funciona mesmo quando <code>/uploads/</code> cai na home do app.</li>
                <li><strong>Link download:</strong> força download para arquivos.</li>
                <li>Os arquivos ficam armazenados no servidor e listados nesta biblioteca.</li>
                <li>Você pode copiar URL com um clique e reutilizar em qualquer campanha.</li>
              </ul>
            </div>
          </div>

          <div className="admin-table-container admin-table-container--full">
            <div className="admin-media-folders">
              <div className="admin-media-folders__row">
                <span className="admin-media-folders__label">Pastas</span>
                <button
                  type="button"
                  className={`admin-media-folder-chip ${mediaFolderFilter === 'none' ? 'active' : ''}`}
                  onClick={() => setMediaFolderFilter('none')}
                >
                  Sem pasta ({mediaAssets.filter((m: any) => !m.folderId).length})
                </button>
                {mediaFolders.map((f: any) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`admin-media-folder-chip ${mediaFolderFilter === f.id ? 'active' : ''}`}
                    onClick={() => setMediaFolderFilter(f.id)}
                    title={`${f._count?.assets ?? 0} arquivo(s)`}
                  >
                    <FolderOpen size={14} />
                    {f.name} ({f._count?.assets ?? 0})
                  </button>
                ))}
              </div>
              <div className="admin-media-folders__create">
                <input
                  type="text"
                  value={newMediaFolderName}
                  onChange={(e) => setNewMediaFolderName(e.target.value)}
                  placeholder="Nome da nova pasta"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void createMediaFolder();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary-sm"
                  disabled={mediaFolderSaving || !newMediaFolderName.trim()}
                  onClick={() => void createMediaFolder()}
                >
                  <FolderPlus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                  {mediaFolderSaving ? 'Criando...' : 'Nova pasta'}
                </button>
                {mediaFolderFilter !== 'none' && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary-sm"
                      onClick={() => {
                        const folder = mediaFolders.find((f: any) => f.id === mediaFolderFilter);
                        if (folder) void renameMediaFolder(folder);
                      }}
                    >
                      Renomear pasta
                    </button>
                    <button
                      type="button"
                      className="btn-danger-sm"
                      onClick={() => {
                        const folder = mediaFolders.find((f: any) => f.id === mediaFolderFilter);
                        if (folder) void deleteMediaFolder(folder);
                      }}
                    >
                      Excluir pasta
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3>Biblioteca ({filteredMediaAssets.length})</h3>
              <div className="admin-search-bar" style={{ marginBottom: 0, minWidth: 260 }}>
                <Search className="admin-search-icon" size={16} />
                <input
                  value={mediaSearch}
                  onChange={(e) => setMediaSearch(e.target.value)}
                  placeholder="Buscar por nome, tipo, pasta ou URL..."
                />
              </div>
            </div>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Arquivo</th>
                    <th>Pasta</th>
                    <th>Tamanho</th>
                    <th>Criado em</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredMediaAssets.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 26, color: 'var(--text-secondary)' }}>
                        Nenhuma mídia encontrada.
                      </td>
                    </tr>
                  ) : (
                    filteredMediaAssets.map((m: any) => {
                      const kind = String(m.kind || 'arquivo');
                      const icon =
                        kind === 'imagem' ? <ImageIcon size={15} /> :
                        kind === 'video' ? <Film size={15} /> :
                        kind === 'audio' ? <Music2 size={15} /> :
                        <FileIcon size={15} />;
                      const fileUrl = `${window.location.origin}/api/public/media/${m.id}/file`;
                      const downloadUrl = `${window.location.origin}/api/public/media/${m.id}/download`;
                      return (
                        <tr key={m.id}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {icon}
                              <span>{kind}</span>
                            </span>
                          </td>
                          <td style={{ maxWidth: 400 }}>
                            <div style={{ fontWeight: 600, marginBottom: 3 }}>{m.originalName}</div>
                            <code>{fileUrl.replace(window.location.origin, '')}</code>
                          </td>
                          <td style={{ minWidth: 160 }}>
                            <select
                              className="admin-media-move-select"
                              value={m.folderId || ''}
                              onChange={(e) => void moveMediaToFolder(m.id, e.target.value)}
                            >
                              <option value="">Sem pasta</option>
                              {mediaFolders.map((f: any) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                              ))}
                            </select>
                          </td>
                          <td>{Math.max(1, Math.round(Number(m.sizeBytes || 0) / 1024))} KB</td>
                          <td>{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
                          <td>
                            <div className="admin-actions admin-actions--wrap">
                              <button type="button" className="btn-secondary-sm" onClick={() => { navigator.clipboard.writeText(fileUrl); alert('Link direto copiado!'); }}>
                                Copiar URL
                              </button>
                              <button type="button" className="btn-secondary-sm" onClick={() => { navigator.clipboard.writeText(downloadUrl); alert('Link de download copiado!'); }}>
                                Copiar download
                              </button>
                              <button type="button" className="btn-secondary-sm" onClick={() => window.open(fileUrl, '_blank', 'noopener,noreferrer')}>
                                Abrir
                              </button>
                              <button
                                type="button"
                                className="btn-danger-sm"
                                onClick={async () => {
                                  if (!window.confirm(`Excluir "${m.originalName}" da biblioteca?`)) return;
                                  const res = await fetch(`/api/admin/media/${m.id}`, {
                                    method: 'DELETE',
                                    headers: { ...authHeaders() }
                                  });
                                  if (!res.ok) {
                                    const j = await res.json().catch(() => ({} as { error?: string }));
                                    alert(j.error || 'Falha ao excluir mídia.');
                                    return;
                                  }
                                  void fetchMediaAssets();
                                  void fetchMediaFolders();
                                }}
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'support' && (
        <div className="admin-content">
          <div className="admin-form">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LifeBuoy size={18} /> Configuração de Suporte
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '15px' }}>
              Defina o link que será aberto quando o cliente clicar em <strong>Suporte</strong> no menu da área de membros.
            </p>

            <label>Link de suporte</label>
            <input
              type="text"
              placeholder="https://wa.me/5511999999999"
              value={emailSettings.member_support_url || ''}
              onChange={(e) => setEmailSettings((prev) => ({ ...prev, member_support_url: e.target.value }))}
            />
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
              Qualquer link com <code>http://</code> ou <code>https://</code> (WhatsApp, Telegram, formulário, etc.).
            </p>

            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: '14px' }}
              onClick={async () => {
                const h = authHeaders();
                if (!h.Authorization) return;
                const value = String(emailSettings.member_support_url || '').trim();
                try {
                  const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...h },
                    body: JSON.stringify({ member_support_url: value }),
                  });
                  if (!res.ok) {
                    const j = (await res.json().catch(() => ({}))) as { error?: string };
                    alert(j.error || 'Erro ao salvar.');
                    return;
                  }
                  alert('Link de suporte salvo com sucesso!');
                  void fetchEmailSettings();
                } catch {
                  alert('Não foi possível salvar o link de suporte.');
                }
              }}
            >
              Salvar link de suporte
            </button>
          </div>
        </div>
      )}

      {/* --- TAB: WEBHOOKS --- */}
      {activeTab === 'webhooks' && (
        <div className="admin-content">
          <div className="admin-form">
            <h3><Webhook size={18} style={{ verticalAlign: 'middle', marginRight: '8px' }}/>Configuração do Webhook Hotmart</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '15px' }}>
              Cole a URL abaixo na sua plataforma de vendas (Hotmart, Kiwify, etc.) para liberação automática de acessos.
            </p>

            <label>URL do Webhook (cole na Hotmart)</label>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 8px' }}>
              Recomendado manter <strong>app.autofintech.com.br</strong> na Hotmart se já estava funcionando.
              Os dois domínios apontam para o mesmo app — qualquer um funciona se o DNS estiver correto.
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <input
                type="text"
                readOnly
                value={webhookUrls?.hotmartWebhook || `${window.location.origin}/api/webhooks/hotmart`}
                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', cursor: 'text' }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const url = webhookUrls?.hotmartWebhook || `${window.location.origin}/api/webhooks/hotmart`;
                  navigator.clipboard.writeText(url);
                  alert('URL copiada!');
                }}
              >
                <Copy size={16} /> Copiar
              </button>
            </div>
            {webhookUrls && webhookUrls.alternateHotmartWebhooks.length > 1 && (
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                URLs alternativas (mesmo backend):{' '}
                {webhookUrls.alternateHotmartWebhooks.map((u) => (
                  <code key={u} style={{ display: 'block', marginTop: '4px' }}>{u}</code>
                ))}
              </p>
            )}

            <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(212,175,55,0.08)', borderRadius: '8px', border: '1px solid rgba(212,175,55,0.2)' }}>
              <h4 style={{ color: 'var(--accent-primary)', marginBottom: '12px' }}>📋 Como Configurar na Hotmart</h4>
              <ol style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.8', paddingLeft: '20px' }}>
                <li>Acesse <strong>Ferramentas → Webhook</strong> na sua conta Hotmart</li>
                <li>Clique em <strong>"Configurar Webhook"</strong></li>
                <li>Cole a <strong>URL acima</strong> no campo de URL</li>
                <li>Selecione os eventos: <code>PURCHASE_APPROVED</code>, <code>PURCHASE_CANCELED</code>, <code>PURCHASE_REFUNDED</code>, <code>PURCHASE_CHARGEBACK</code></li>
                <li>Copie o <strong>Hottok</strong> da Hotmart e configure em <code>HOTMART_HOTTOK</code> (EasyPanel) <strong>ou</strong> em Admin → Segurança → Token do webhook</li>
                <li>Salve e faça uma <strong>compra teste</strong> para validar</li>
              </ol>
            </div>

            <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(102,187,106,0.08)', borderRadius: '8px', border: '1px solid rgba(102,187,106,0.2)' }}>
              <h4 style={{ color: 'var(--accent-primary)', marginBottom: '8px' }}>⚙️ Como Funciona</h4>
              <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.8', paddingLeft: '20px' }}>
                <li><strong>Compra Aprovada:</strong> O sistema cria o usuário automaticamente e libera o livro correspondente ao <code>Código da Oferta</code></li>
                <li><strong>Reembolso/Cancelamento:</strong> O acesso ao livro é revogado automaticamente</li>
                <li>O <strong>Código da Oferta</strong> na Hotmart deve corresponder ao produto configurado para liberação automática</li>
              </ul>
            </div>
          </div>

          <div className="admin-table-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3>Log de Eventos ({webhookLogs.length})</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-icon" onClick={() => void fetchWebhookLogs()} title="Atualizar">
                  <RefreshCw size={16} />
                </button>
                <button className="btn-icon btn-danger" onClick={async () => {
                  if (!window.confirm('Limpar todos os logs?')) return;
                  await fetch('/api/admin/webhook-logs', { method: 'DELETE', headers: { ...authHeaders() } });
                  setWebhookLogs([]);
                }} title="Limpar Logs">
                  <Trash size={16} />
                </button>
              </div>
            </div>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Evento</th>
                    <th>Comprador</th>
                    <th>E-mail</th>
                    <th style={{ textAlign: 'center' }}>País</th>
                    <th>Produto</th>
                    <th>Status</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookLogs.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>Nenhum evento recebido ainda. Configure o webhook na Hotmart e faça uma compra teste.</td></tr>
                  ) : (
                    pagedWebhookLogs.map(log => (
                      <tr key={log.id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '11px' }}>{new Date(log.createdAt).toLocaleString('pt-BR')}</td>
                        <td><code>{log.event}</code></td>
                        <td style={{ fontSize: '12px', fontWeight: '500' }}>{log.buyerName || '-'}</td>
                        <td style={{ fontSize: '12px' }}>{log.buyerEmail || '-'}</td>
                        <td style={{ textAlign: 'center', fontSize: '16px' }}>
                          {log.buyerCountry ? (
                            <span title={log.buyerCountry}>
                              {log.buyerCountry === 'BR' ? '🇧🇷' : 
                               log.buyerCountry === 'PT' ? '🇵🇹' :
                               ['AR', 'MX', 'CO', 'ES', 'CL', 'PE', 'EC', 'UY', 'PY', 'BO', 'VE'].includes(log.buyerCountry) ? '🇪🇸' : 
                               `🌍 (${log.buyerCountry})`}
                            </span>
                          ) : '-'}
                        </td>
                        <td><code>{log.productId || '-'}</code></td>
                        <td>
                          <span className={`webhook-status webhook-status-${log.status}`}>
                            {log.status === 'success' ? '✅' : log.status === 'error' ? '❌' : log.status === 'rejected' ? '🚫' : log.status === 'warning' ? '⚠️' : '📌'}
                            {' '}{log.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.details || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
              {webhookLogs.length > 0 && (
                <AdminPagination page={pageWebhooks} totalItems={webhookLogs.length} onChange={setPageWebhooks} />
              )}
          </div>
        </div>
      )}

      {/* --- TAB: EMAIL CONFIG --- */}
      {activeTab === 'email' && (
        <div className="admin-content">
          <div className="admin-page-frame">
            <div className="admin-form">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Mail size={20} /> Configurações de E-mail</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '15px' }}>
                Configure o token da API Resend e o remetente para envio de e-mails transacionais (boas-vindas e recuperação de senha).
              </p>

              <label>Token da API Resend</label>
              <input
                type="password"
                placeholder="re_xxxxxxxxxx"
                value={emailSettings.resend_api_key}
                onChange={e => setEmailSettings(p => ({ ...p, resend_api_key: e.target.value }))}
              />
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '-6px' }}>
                Este valor não é exibido por segurança. Para atualizar, cole um novo token e salve.
              </p>

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label>Nome do Remetente</label>
                  <input
                    placeholder="Ex: Readlyme"
                    value={emailSettings.sender_name}
                    onChange={e => setEmailSettings(p => ({ ...p, sender_name: e.target.value }))}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <label>E-mail do Remetente</label>
                  <input
                    type="email"
                    placeholder="noreply@seudominio.com"
                    value={emailSettings.sender_email}
                    onChange={e => setEmailSettings(p => ({ ...p, sender_email: e.target.value }))}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: '14px',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 152, 0, 0.25)',
                  background: 'rgba(255, 152, 0, 0.08)',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                }}
              >
                <strong style={{ color: '#ffb74d' }}>Importante — destinatário vs remetente</strong>
                <br />
                O e-mail do comprador vem do webhook Hotmart (<code>data.buyer.email</code>). O campo acima é só o <strong>remetente</strong> (From).
                <br />
                No Resend, o domínio do remetente precisa estar verificado — senão os e-mails podem falhar ou ir só para a conta do Resend.
                <br />
                Se você ainda usa o plugin WordPress de licenças, ele envia uma <strong>notificação de admin</strong> para <code>contato@victorhamber.com</code> — isso não é o e-mail de boas-vindas do comprador.
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '16px' }}>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <label>Testar envio para um comprador</label>
                  <input
                    type="email"
                    placeholder="email-do-comprador@exemplo.com"
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary-sm"
                  disabled={testEmailSending}
                  onClick={() => void sendTestEmail()}
                  style={{ marginBottom: '2px' }}
                >
                  {testEmailSending ? 'Enviando...' : 'Enviar e-mail de teste'}
                </button>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                Use um e-mail que <strong>não</strong> seja o seu admin. Se o teste chegar na caixa certa, o fluxo de compra também deve funcionar.
              </p>

              <hr style={{ borderColor: 'var(--border-subtle)', margin: '20px 0' }} />

              <div style={{ 
                background: 'rgba(59, 130, 246, 0.05)', 
                padding: '20px', 
                borderRadius: '12px', 
                border: '1px solid rgba(59, 130, 246, 0.1)', 
                marginBottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <h4 style={{ margin: '0 0 5px 0', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>🇧🇷 Português (Brasil)</h4>
                
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                  Edite apenas o <strong>texto</strong> dos e-mails. O layout visual (cores, botão &quot;Acessar área de membros&quot; e cabeçalho Autofintech) é aplicado automaticamente no envio.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ marginTop: '0' }}>E-mail de Boas-vindas</label>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0' }}>
                    Placeholders: {'{{name}}'}, {'{{email}}'}, {'{{password}}'}, {'{{app_url}}'} — inclua {'{{app_url}}'} no texto para o link da home; use linha em branco entre parágrafos.
                  </p>
                </div>
                <textarea
                  rows={8}
                  className="admin-email-body-text"
                  placeholder="Texto do e-mail de boas-vindas..."
                  value={emailSettings.welcome_template_pt}
                  onChange={e => setEmailSettings(p => ({ ...p, welcome_template_pt: e.target.value }))}
                  style={{ marginBottom: '10px' }}
                />
                <button
                  type="button"
                  className="btn-secondary-sm"
                  style={{ alignSelf: 'flex-start', marginBottom: 14 }}
                  onClick={() => setEmailSettings((p) => ({ ...p, welcome_template_pt: DEFAULT_WELCOME_BODY_PT }))}
                >
                  Restaurar texto de boas-vindas
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ marginTop: '0' }}>Recuperação de Senha</label>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0' }}>
                    Placeholders: {'{{name}}'}, {'{{reset_link}}'} — o botão &quot;Redefinir senha&quot; é incluído automaticamente.
                  </p>
                </div>
                <textarea
                  rows={8}
                  className="admin-email-body-text"
                  placeholder="Texto do e-mail de recuperação de senha..."
                  value={emailSettings.reset_template_pt}
                  onChange={e => setEmailSettings(p => ({ ...p, reset_template_pt: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn-secondary-sm"
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  onClick={() => setEmailSettings((p) => ({ ...p, reset_template_pt: DEFAULT_RESET_BODY_PT }))}
                >
                  Restaurar texto de recuperação
                </button>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '12px 0 0' }}>
                  Apenas textos em português são editáveis aqui. Compradores de países hispanohablantes seguem o modelo padrão em espanhol do sistema.
                </p>
              </div>

              <button
                type="button"
                className="login-submit-btn"
                disabled={emailSaving}
                onClick={() => void saveEmailSettings()}
                style={{ 
                  marginTop: '10px', 
                  background: 'var(--accent-primary)', 
                  color: '#fff',
                  width: '100%',
                  fontWeight: 'bold',
                  padding: '14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border: 'none'
                }}
              >
                {emailSaving ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            </div>

            {/* Info panel */}
            <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px', border: '1px solid var(--border-subtle)' }}>
              <h4 style={{ marginTop: 0, color: 'var(--accent-primary)' }}>Como funciona</h4>
              <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '18px' }}>
                <li>Usamos o provedor <strong>Resend</strong> para envio de e-mails transacionais.</li>
                <li>O token é salvo no banco de dados e usado apenas no backend.</li>
                <li>Os textos aceitam placeholders substituídos automaticamente no envio.</li>
                <li>O design do e-mail (layout) é fixo; você edita somente a mensagem.</li>
                <li>Novos compradores recebem a senha padrão <code>Mudar123@</code>.</li>
                <li>O idioma do e-mail é definido automaticamente pelo país do comprador.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'products' && (
        <div className="admin-content admin-content--stack">
          <div className="admin-grid-2">
            <div className="admin-form">
              <h3>{editingProductId ? 'Editar produto' : 'Cadastro do produto'}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                {editingProductId
                  ? 'Altere os dados do produto e clique em salvar. O download do robô continua no painel ao lado.'
                  : 'O webhook Hotmart identifica o produto pelo código da oferta. A partir dele o sistema aplica systemId, plano e nome automaticamente na licença.'}
              </p>
              <label>Nome</label>
              <input value={newProduct.productName} onChange={e => setNewProduct(p => ({ ...p, productName: e.target.value }))} />
              <label>system_id</label>
              <input
                value={newProduct.systemId}
                onChange={e => setNewProduct(p => ({ ...p, systemId: e.target.value }))}
                placeholder="Ex.: 4102900 ou 4102900,5162473 (separe por vírgula)"
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                Use vírgulas para vincular o produto a vários sistemas (cria/ativa uma licença para cada um).
              </small>
              <label>offer_code (Hotmart) *</label>
              <input
                value={newProduct.offerCode}
                onChange={e => setNewProduct(p => ({ ...p, offerCode: e.target.value }))}
                placeholder="Ex.: dghySD ou dghySD,abcDEF (separe por vírgula)"
              />
              <small style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                Código enviado no webhook (<code>purchase.offer.code</code>). É ele que define qual produto/plano o cliente recebe — mesmo quando vários produtos compartilham o mesmo systemId.
              </small>
              <label>plano</label>
              <select value={newProduct.plano} onChange={e => setNewProduct(p => ({ ...p, plano: e.target.value }))}>
                {PLAN_OPTIONS.map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>

              <div className="admin-form-actions">
                {editingProductId != null && (
                  <button type="button" className="btn-cancel" onClick={cancelEditProduct}>
                    Cancelar edição
                  </button>
                )}
                <button type="button" className="btn-primary" onClick={async () => {
              if (!newProduct.productName.trim() || !newProduct.systemId.trim() || !newProduct.offerCode.trim()) {
                alert('Preencha nome, system_id e offer_code (Hotmart).');
                return;
              }
              const isEdit = editingProductId != null;
              const res = await fetch(
                isEdit ? `/api/admin/products/${editingProductId}` : '/api/admin/products',
                {
                  method: isEdit ? 'PUT' : 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders() },
                  body: JSON.stringify(newProduct),
                }
              );
              if (res.ok) {
                alert(isEdit ? 'Produto atualizado.' : 'Produto cadastrado.');
                void fetchProducts();
                cancelEditProduct();
              } else alert('Falha ao salvar produto.');
                }}>{editingProductId ? 'Salvar alterações' : 'Cadastrar produto'}</button>
              </div>
            </div>

            <div className="admin-form">
              <h3>Download do robô</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                Selecione um produto na tabela para enviar/atualizar o arquivo e a versão.
              </p>
              {selectedProductForDownload ? (
                <>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Produto: <strong>{selectedProductForDownload.productName}</strong> — <code>{selectedProductForDownload.systemId}</code>
                  </p>
                  <label>Upload do executável/zip</label>
                  <input type="file" onChange={e => setRobotFile(e.target?.files?.[0] || null)} />
                  <label>Versão (opcional)</label>
                  <input
                    value={String(selectedProductForDownload.downloadVersion || '')}
                    onChange={e => setSelectedProductForDownload((prev: any) => ({ ...prev, downloadVersion: e.target.value }))}
                    placeholder="ex: 1.0.3"
                  />
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!robotFile && !selectedProductForDownload.downloadVersion}
                      onClick={async () => {
                        try {
                          let downloadUrl = selectedProductForDownload.downloadUrl as string | null;
                          let downloadFileName = selectedProductForDownload.downloadFileName as string | null;
                          if (robotFile) {
                            const url = await uploadFile(robotFile);
                            downloadUrl = url;
                            downloadFileName = robotFile.name;
                          }
                          const res = await fetch(`/api/admin/products/${selectedProductForDownload.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', ...authHeaders() },
                            body: JSON.stringify({
                              downloadUrl,
                              downloadFileName,
                              downloadVersion: selectedProductForDownload.downloadVersion || null
                            })
                          });
                          if (res.ok) {
                            alert('Download do robô atualizado.');
                            setRobotFile(null);
                            setSelectedProductForDownload(null);
                            void fetchProducts();
                          } else alert('Falha ao salvar.');
                        } catch {
                          alert('Falha no upload.');
                        }
                      }}
                    >
                      Salvar download
                    </button>
                    {selectedProductForDownload.downloadUrl && (
                      <button
                        type="button"
                        className="btn-danger-sm"
                        onClick={async () => {
                          if (!window.confirm('Remover o arquivo de download desse produto?')) return;
                          const res = await fetch(`/api/admin/products/${selectedProductForDownload.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', ...authHeaders() },
                            body: JSON.stringify({ downloadUrl: null, downloadFileName: null })
                          });
                          if (res.ok) {
                            alert('Removido.');
                            setRobotFile(null);
                            setSelectedProductForDownload(null);
                            void fetchProducts();
                          } else alert('Falha.');
                        }}
                      >
                        Remover arquivo
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>Nenhum produto selecionado.</p>
              )}
            </div>
          </div>

          <div className="admin-table-container admin-table-container--full">
            <h3>Produtos ({products.length})</h3>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr><th>ID</th><th>Nome</th><th>offer_code</th><th>Plano</th><th>systemId</th><th>Download</th><th>Versão</th><th /></tr>
                </thead>
                <tbody>
                  {pagedProducts.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>{p.productName}</td>
                      <td>
                        <div className="admin-csv-pills">
                          {String(p.offerCode || '')
                            .split(',')
                            .map((v: string) => v.trim())
                            .filter(Boolean)
                            .map((v: string) => (
                              <code key={v} className="admin-csv-pill">{v}</code>
                            ))}
                          {!String(p.offerCode || '').trim() ? (
                            <span className="admin-table-muted">—</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{p.plano || '—'}</td>
                      <td>
                        <div className="admin-csv-pills">
                          {String(p.systemId || '')
                            .split(',')
                            .map((v: string) => v.trim())
                            .filter(Boolean)
                            .map((v: string) => (
                              <code key={v} className="admin-csv-pill">{v}</code>
                            ))}
                        </div>
                      </td>
                      <td>
                        {p.downloadUrl ? (
                          <a className="admin-table-link" href={p.downloadUrl} target="_blank" rel="noreferrer">
                            {p.downloadFileName ? p.downloadFileName : 'arquivo'}
                          </a>
                        ) : (
                          <span className="admin-table-muted">—</span>
                        )}
                      </td>
                      <td>{p.downloadVersion || '—'}</td>
                      <td>
                        <div className="admin-actions admin-actions--wrap">
                        <button
                          type="button"
                          className={`btn-secondary-sm ${editingProductId === p.id ? 'active' : ''}`}
                          onClick={() => startEditProduct(p)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary-sm"
                          onClick={() => { setSelectedProductForDownload(p); setRobotFile(null); cancelEditProduct(); }}
                        >
                          Gerenciar download
                        </button>
                        <button type="button" className="btn-danger-sm" onClick={async () => {
                          if (!window.confirm('Excluir produto?')) return;
                          if (editingProductId === p.id) cancelEditProduct();
                          await fetch(`/api/admin/products/${p.id}`, { method: 'DELETE', headers: { ...authHeaders() } });
                          void fetchProducts();
                        }}>Excluir</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              <AdminPagination page={pageProducts} totalItems={products.length} onChange={setPageProducts} />
          </div>
        </div>
      )}

      {activeTab === 'builder' && (
        <div className="admin-content admin-content--stack">
          {!builderLoadedOnce && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 12 }}>
              Carregando páginas do construtor…
            </p>
          )}
          {builderLoadedOnce && builderPages.length === 0 && (
            <div className="admin-form" style={{ marginBottom: 12, borderColor: 'var(--accent-primary)' }}>
              <p style={{ fontSize: 13, margin: 0, color: 'var(--text-secondary)' }}>
                Nenhuma página salva no banco. Crie a primeira clicando em <strong>Nova página</strong>.
              </p>
            </div>
          )}
          <div className="admin-form" style={{ marginBottom: 12 }}>
            <details>
              <summary style={{ fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Manutenção do construtor (avançado)
              </summary>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>
                Apaga todas as páginas, pastas e backups internos do construtor. Não toca em nenhum outro dado do app, nem no WordPress. Use só para começar do zero.
              </p>
              <button
                type="button"
                className="btn-danger-sm"
                onClick={async () => {
                  const h = authHeaders();
                  if (!h.Authorization) return;
                  const ok1 = window.confirm('Apagar TODAS as páginas e pastas do construtor? Esta ação não pode ser desfeita.');
                  if (!ok1) return;
                  const typed = window.prompt('Confirme digitando: APAGAR TUDO');
                  if (typed !== 'APAGAR TUDO') {
                    alert('Confirmação cancelada.');
                    return;
                  }
                  try {
                    const r = await fetch('/api/admin/page-builder/reset', {
                      method: 'POST',
                      headers: { ...h, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ confirm: 'APAGAR TUDO' }),
                    });
                    if (!r.ok) {
                      const j = (await r.json().catch(() => ({}))) as { error?: string };
                      alert(j.error || 'Falha ao apagar.');
                      return;
                    }
                    alert('Construtor zerado. Recarregando…');
                    window.location.reload();
                  } catch {
                    alert('Erro de conexão ao apagar.');
                  }
                }}
              >
                Apagar tudo e começar do zero
              </button>
            </details>
          </div>
          {builderStep === 'list' && (
            <div className="admin-form">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                Organize seus sistemas em pastas. Só aparecem as páginas da pasta selecionada — sem lista geral.
              </p>

              <div className="admin-media-folders admin-builder-folders">
                <div className="admin-media-folders__row">
                  <span className="admin-media-folders__label">Pastas</span>
                  {builderFolders.map((f) => {
                    const count = builderPages.filter((p) => p.folderId === f.id).length;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`admin-media-folder-chip ${builderSelectedFolderId === f.id ? 'active' : ''}`}
                        onClick={() => setBuilderSelectedFolderId(f.id)}
                      >
                        <FolderOpen size={14} />
                        {f.name} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="admin-media-folders__create">
                  <input
                    type="text"
                    value={newBuilderFolderName}
                    onChange={(e) => setNewBuilderFolderName(e.target.value)}
                    placeholder="Nome da pasta (ex.: Sistema X)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void createBuilderFolder();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    disabled={builderFolderSaving || !newBuilderFolderName.trim()}
                    onClick={() => void createBuilderFolder()}
                  >
                    <FolderPlus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                    {builderFolderSaving ? 'Criando...' : 'Nova pasta'}
                  </button>
                  {builderSelectedFolder && (
                    <>
                      <button type="button" className="btn-secondary-sm" onClick={() => void renameBuilderFolder(builderSelectedFolder)}>
                        Renomear pasta
                      </button>
                      <button type="button" className="btn-danger-sm" onClick={() => void deleteBuilderFolder(builderSelectedFolder)}>
                        Excluir pasta
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="admin-builder-list-head">
                <h3>
                  {builderSelectedFolder
                    ? `Páginas em “${builderSelectedFolder.name}” (${builderPagesInFolder.length})`
                    : 'Selecione uma pasta'}
                </h3>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!builderSelectedFolderId}
                  onClick={() => {
                    if (!builderSelectedFolderId) {
                      alert('Selecione ou crie uma pasta primeiro.');
                      return;
                    }
                    setBuilderStep('setup');
                  }}
                >
                  Criar nova página
                </button>
              </div>

              {!builderSelectedFolderId ? (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 24 }}>
                  Crie uma pasta acima para começar a organizar suas páginas HTML.
                </p>
              ) : (
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Slug</th>
                        <th>Status</th>
                        <th>Atualizada</th>
                        <th>Pasta</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {builderPagesInFolder.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 20 }}>
                            Nenhuma página nesta pasta. Clique em &quot;Criar nova página&quot;.
                          </td>
                        </tr>
                      ) : (
                        builderPagesInFolder.map((p) => (
                          <tr key={p.slug}>
                            <td><code>{p.slug}</code></td>
                            <td>
                              <span className={`admin-license-status-pill admin-license-status-pill--${p.published ? 'ativa' : 'inativa'}`}>
                                {p.published ? 'publicada' : 'rascunho'}
                              </span>
                            </td>
                            <td>{new Date(p.updatedAt).toLocaleString('pt-BR')}</td>
                            <td style={{ minWidth: 140 }}>
                              <select
                                className="admin-media-move-select"
                                value={p.folderId || ''}
                                onChange={(e) => void moveBuilderPageFolder(p.slug, e.target.value)}
                              >
                                {builderFolders.map((f) => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <div className="admin-actions admin-actions--wrap">
                                <button type="button" className="btn-secondary-sm" onClick={() => openBuilderPage(p.slug)}>Editar</button>
                                {p.published ? (
                                  <button
                                    type="button"
                                    className="btn-secondary-sm"
                                    onClick={() => void toggleBuilderPagePublished(p.slug, false)}
                                  >
                                    Despublicar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-primary"
                                    style={{ padding: '6px 12px', fontSize: 12 }}
                                    onClick={() => void toggleBuilderPagePublished(p.slug, true)}
                                  >
                                    Publicar
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-secondary-sm"
                                  onClick={() => {
                                    const base = normalizeBuilderSlug(`${p.slug}-copia`);
                                    let slug = base;
                                    let i = 2;
                                    while (builderPages.some((x) => x.slug === slug)) {
                                      slug = `${base}-${i++}`;
                                    }
                                    const copy: BuilderPage = {
                                      ...p,
                                      slug,
                                      published: false,
                                      updatedAt: new Date().toISOString(),
                                      folderId: builderSelectedFolderId,
                                    };
                                    const next = [copy, ...builderPages];
                                    setBuilderPages(next);
                                    void persistBuilderPagesSetting(next);
                                  }}
                                >
                                  Duplicar
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary-sm"
                                  onClick={() => {
                                    const cleanSlug = normalizeBuilderSlug(p.slug);
                                    const pageUrl = `${window.location.origin}/${encodeURIComponent(cleanSlug)}`;
                                    navigator.clipboard.writeText(pageUrl);
                                    alert('URL da página copiada!');
                                  }}
                                >
                                  Copiar URL
                                </button>
                                <button
                                  type="button"
                                  className="btn-danger-sm"
                                  onClick={() => {
                                    if (!window.confirm(`Excluir página "${p.slug}"?`)) return;
                                    setBuilderPages((prev) => {
                                      const next = prev.filter((x) => x.slug !== p.slug);
                                      void persistBuilderPagesSetting(next);
                                      return next;
                                    });
                                    if (builderCurrentSlug === p.slug) {
                                      setBuilderCurrentSlug('');
                                      setBuilderCodeDraft(DEFAULT_BUILDER_HTML);
                                    }
                                  }}
                                >
                                  Excluir
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {builderStep === 'setup' && (
            <div className="admin-form">
              <h3>Criar nova página</h3>
              <p className="admin-builder-meta">
                Pasta: <strong>{builderSelectedFolder?.name || '—'}</strong> — Etapa 1: configure slug e códigos opcionais de <code>head</code> e <code>body</code>.
              </p>
              <label>Slug da página</label>
              <input value={builderSetupSlug} onChange={(e) => setBuilderSetupSlug(e.target.value)} placeholder="ex: oferta-principal" />
              <label>Área</label>
              <select value={builderSetupTarget} onChange={(e) => setBuilderSetupTarget(e.target.value as BuilderPageTarget)}>
                <option value="header">header</option>
                <option value="body">body</option>
              </select>
              <label>Código extra no HEAD (opcional)</label>
              <textarea rows={6} value={builderSetupHeadCode} onChange={(e) => setBuilderSetupHeadCode(e.target.value)} placeholder="Meta Pixel, GTM, scripts..." />
              <label>Código extra no BODY (opcional)</label>
              <textarea rows={6} value={builderSetupBodyCode} onChange={(e) => setBuilderSetupBodyCode(e.target.value)} placeholder="Snippets de body..." />
              <div className="admin-form-actions">
                <button type="button" className="btn-cancel" onClick={() => setBuilderStep('list')}>Cancelar</button>
                <button type="button" className="btn-primary" onClick={handleBuilderCreateContinue}>Continuar</button>
              </div>
            </div>
          )}

          {builderStep === 'html' && (
            <div className="admin-form admin-builder-panel">
              <div className="admin-builder-list-head">
                <h3>HTML da página {builderCurrentPage ? <code>{builderCurrentPage.slug}</code> : ''}</h3>
                <button type="button" className="btn-secondary-sm" onClick={() => setBuilderStep('list')}>Voltar à lista</button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                Etapa 2: cole ou edite o HTML. Scripts de rastreamento (pixel, Trajettu, GTM) vão no campo <strong>HEAD</strong>.
                Use <strong>Salvar e publicar</strong> para liberar a URL pública — o código do HEAD roda na página real (não só no preview).
              </p>
              <label>Área da página (head/body)</label>
              <select
                value={builderCurrentPage?.target || 'body'}
                onChange={(e) => updateBuilderCurrentTarget(e.target.value as BuilderPageTarget)}
                disabled={!builderCurrentSlug}
              >
                <option value="header">header</option>
                <option value="body">body</option>
              </select>
              <label>Código do HEAD (scripts/pixel/GTM)</label>
              <textarea
                rows={6}
                value={builderHeadCodeDraft}
                onChange={(e) => {
                  const nextHead = e.target.value;
                  setBuilderHeadCodeDraft(nextHead);
                  setBuilderCodeDraft((prev) => setBuilderHtmlSections(prev, { head: nextHead, body: builderBodyCodeDraft }));
                }}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                placeholder="Ex: pixel, GTM, scripts, metas..."
                disabled={!builderCurrentSlug}
              />
              <label>HTML (conteúdo da página)</label>
              <textarea
                rows={22}
                value={builderBodyCodeDraft}
                onChange={(e) => {
                  const nextBody = e.target.value;
                  setBuilderBodyCodeDraft(nextBody);
                  setBuilderCodeDraft((prev) => setBuilderHtmlSections(prev, { head: builderHeadCodeDraft, body: nextBody }));
                }}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, minHeight: 520 }}
                placeholder="Cole aqui o HTML do conteúdo da página (body)..."
                disabled={!builderCurrentSlug}
              />
              <div className="admin-form-actions">
                <button
                  type="button"
                  className="btn-secondary-sm"
                  disabled={!builderCurrentSlug}
                  onClick={() => {
                    const html = (builderCodeDraft || '').trim() || DEFAULT_BUILDER_HTML;
                    setBuilderPreviewHtml(toBuilderVisualPreviewHtml(html));
                    setBuilderVisualOpen(true);
                  }}
                >
                  Editor visual
                </button>
                <button type="button" className="btn-secondary-sm" disabled={builderSaving} onClick={() => void saveBuilderPages({ conclude: true })}>
                  {builderSaving ? 'Salvando…' : 'Salvar rascunho'}
                </button>
                <button type="button" className="btn-primary" disabled={builderSaving} onClick={() => void saveBuilderPages({ publish: true, conclude: true })}>
                  {builderSaving ? 'Salvando…' : 'Salvar e publicar'}
                </button>
              </div>
            </div>
          )}

          {builderVisualOpen && (
            <div className="admin-modal-overlay admin-builder-visual-overlay">
              <div className="admin-modal admin-builder-visual-modal">
                <div className="admin-builder-visual-head">
                  <h2>Edição visual</h2>
                  <div className="admin-builder-visual-head-actions">
                    <button type="button" className={`btn-secondary-sm ${builderPreviewMode === 'desktop' ? 'active' : ''}`} onClick={() => setBuilderPreviewMode('desktop')}>
                      Desktop
                    </button>
                    <button type="button" className={`btn-secondary-sm ${builderPreviewMode === 'mobile' ? 'active' : ''}`} onClick={() => setBuilderPreviewMode('mobile')}>
                      Mobile
                    </button>
                    <button type="button" className="btn-secondary-sm" onClick={() => openBuilderPreviewNewTab(builderPreviewMode)}>
                      Preview local
                    </button>
                    <button type="button" className="btn-secondary-sm" onClick={openBuilderPublicUrl}>
                      Abrir URL pública
                    </button>
                    <button type="button" className="btn-primary" disabled={builderSaving} onClick={() => void saveBuilderPages({ publish: true })}>
                      {builderSaving ? 'Salvando…' : 'Salvar e publicar'}
                    </button>
                    <button type="button" className="btn-cancel" onClick={() => setBuilderVisualOpen(false)}>
                      Fechar
                    </button>
                  </div>
                </div>
                <div className="admin-builder-visual-body">
                  <div className={`admin-builder-preview-shell admin-builder-preview-shell--${builderPreviewMode}`}>
                    <iframe
                      ref={builderIframeRef}
                      className="admin-builder-preview"
                      title="Preview visual do construtor"
                      srcDoc={builderPreviewHtml || DEFAULT_BUILDER_HTML}
                      onLoad={handleBuilderIframeLoad}
                    />
                  </div>
                  <aside className="admin-builder-inspector">
                    <h4>Editar conteúdo</h4>
                    <p className="admin-builder-inspector-help">
                      {builderSelectedPath
                        ? 'Elemento selecionado. Edite os campos abaixo.'
                        : 'Clique em um elemento no preview para editar.'}
                    </p>
                    <label>Texto</label>
                    <textarea
                      rows={4}
                      value={builderSelectedText}
                      onChange={(e) => {
                        setBuilderSelectedText(e.target.value);
                        applyBuilderVisualValues({ text: e.target.value });
                      }}
                      disabled={!builderSelectedPath}
                    />
                    <label>Link (href)</label>
                    <input
                      value={builderSelectedHref}
                      onChange={(e) => {
                        setBuilderSelectedHref(e.target.value);
                        applyBuilderVisualValues({ href: e.target.value });
                      }}
                      placeholder="https://..."
                      disabled={!builderSelectedPath}
                    />
                    <div className="admin-builder-inspector-grid">
                      <div>
                        <label>Cor do texto</label>
                        <input
                          type="color"
                          value={builderSelectedTextColor}
                          onChange={(e) => {
                            setBuilderSelectedTextColor(e.target.value);
                            applyBuilderVisualValues({ textColor: e.target.value });
                          }}
                          disabled={!builderSelectedPath}
                        />
                      </div>
                      <div>
                        <label>Cor de fundo</label>
                        <input
                          type="color"
                          value={builderSelectedBgColor}
                          onChange={(e) => {
                            setBuilderSelectedBgColor(e.target.value);
                            applyBuilderVisualValues({ bgColor: e.target.value });
                          }}
                          disabled={!builderSelectedPath}
                        />
                      </div>
                    </div>
                    <label>Alinhamento</label>
                    <div className="admin-builder-align-row">
                      <button type="button" className={`btn-secondary-sm ${builderSelectedAlign === 'left' ? 'active' : ''}`} disabled={!builderSelectedPath} onClick={() => { setBuilderSelectedAlign('left'); applyBuilderVisualValues({ align: 'left' }); }}>Esquerda</button>
                      <button type="button" className={`btn-secondary-sm ${builderSelectedAlign === 'center' ? 'active' : ''}`} disabled={!builderSelectedPath} onClick={() => { setBuilderSelectedAlign('center'); applyBuilderVisualValues({ align: 'center' }); }}>Centro</button>
                      <button type="button" className={`btn-secondary-sm ${builderSelectedAlign === 'right' ? 'active' : ''}`} disabled={!builderSelectedPath} onClick={() => { setBuilderSelectedAlign('right'); applyBuilderVisualValues({ align: 'right' }); }}>Direita</button>
                    </div>
                    <div className="admin-builder-inspector-grid admin-builder-inspector-grid--offsets">
                      <div>
                        <label>Mais para cima/baixo (px)</label>
                        <input
                          type="number"
                          value={builderOffsetY}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            setBuilderOffsetY(v);
                            applyBuilderVisualValues({ offsetY: v });
                          }}
                          disabled={!builderSelectedPath}
                        />
                      </div>
                      <div>
                        <label>Mais para esquerda/direita (px)</label>
                        <input
                          type="number"
                          value={builderOffsetX}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            setBuilderOffsetX(v);
                            applyBuilderVisualValues({ offsetX: v });
                          }}
                          disabled={!builderSelectedPath}
                        />
                      </div>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'forexEA' && (
        <div className="admin-content">
          <div className="admin-form">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Key size={20} /> Segurança EA / Webhook</h3>
            <label>Token do webhook (Hotmart / header hottok)</label>
            <input type="password" value={forexWebhook} onChange={e => setForexWebhook(e.target.value)} />
            <label>API Keys para validação (uma por linha)</label>
            <textarea rows={6} value={forexApiLines} onChange={e => setForexApiLines(e.target.value)} style={{ width: '100%', fontFamily: 'monospace' }} />
            <button type="button" className="btn-primary" onClick={async () => {
              const keys = forexApiLines.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
              const res = await fetch('/api/admin/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ forex_webhook_token: forexWebhook, forex_api_keys: JSON.stringify(keys) })
              });
              if (res.ok) alert('Salvo');
              else alert('Erro ao salvar');
            }}>Salvar</button>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
              URL do webhook de licenças: <code>{webhookUrls?.forexWebhook || (typeof window !== 'undefined' ? `${window.location.origin}/api/forex-rendimento/v1/webhook` : '')}</code>
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Ver arquivo no projeto: <code>docs/EA_API.md</code>
            </p>
          </div>
        </div>
      )}

        </div>
      </div>
    </div>
  );
};
