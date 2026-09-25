/** Abas da área de membros (links internos no texto da aula). */
export type MemberTabLink = 'home' | 'courses' | 'downloads' | 'validation' | 'management' | 'profile';

/** Mesma chave usada em App.tsx para restaurar a aba ao abrir nova guia. */
export const MEMBER_TAB_STORAGE_KEY = 'contentpro_member_tab';

export const MEMBER_TAB_LINK_OPTIONS: { value: MemberTabLink; label: string }[] = [
  { value: 'home', label: 'Início' },
  { value: 'courses', label: 'Cursos' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'validation', label: 'Minhas licenças' },
  { value: 'management', label: 'Gestão' },
  { value: 'profile', label: 'Perfil' },
];

export function persistMemberTab(tab: MemberTabLink): void {
  sessionStorage.setItem(MEMBER_TAB_STORAGE_KEY, tab);
}

const memberTabHash = (tab: MemberTabLink) => `#member-tab:${tab}`;

/** URL do link no HTML (hash funciona na mesma guia e ao abrir nova guia). */
export function memberTabHref(tab: MemberTabLink, newTab: boolean): string {
  if (typeof window === 'undefined') {
    return newTab ? memberTabHash(tab) : memberTabHash(tab);
  }
  if (newTab) return `${window.location.origin}/${memberTabHash(tab)}`;
  return memberTabHash(tab);
}

/** Abre a área de membros em nova guia na aba correta (hash — sessionStorage não é compartilhado entre abas). */
export function openMemberTabInNewWindow(tab: MemberTabLink): void {
  persistMemberTab(tab);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  window.open(`${origin}/${memberTabHash(tab)}`, '_blank', 'noopener,noreferrer');
}

/** Lê aba de destino na URL atual (?tab= legado ou #member-tab:). */
export function readMemberTabFromLocation(): MemberTabLink | null {
  if (typeof window === 'undefined') return null;
  const fromHash = parseMemberTabFromHref(window.location.hash);
  if (fromHash) return fromHash;
  try {
    const tab = new URLSearchParams(window.location.search).get('tab') as MemberTabLink | null;
    if (tab && MEMBER_TAB_LINK_OPTIONS.some((o) => o.value === tab)) return tab;
  } catch {
    /* ignore */
  }
  return null;
}

/** Remove ?tab= e #member-tab: da barra de endereço após aplicar a navegação. */
export function clearMemberTabNavigationFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const hadTabQuery = url.searchParams.has('tab');
  const hadMemberHash = url.hash.startsWith('#member-tab:');
  if (!hadTabQuery && !hadMemberHash) return;
  url.searchParams.delete('tab');
  if (hadMemberHash) url.hash = '';
  const qs = url.searchParams.toString();
  window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
}

/** @deprecated use clearMemberTabNavigationFromUrl */
export function clearMemberTabQueryFromUrl(): void {
  clearMemberTabNavigationFromUrl();
}

function parseMemberTabToken(token: string): MemberTabLink | null {
  const tab = token.trim() as MemberTabLink;
  return MEMBER_TAB_LINK_OPTIONS.some((o) => o.value === tab) ? tab : null;
}

export function parseMemberTabFromHref(href: string): MemberTabLink | null {
  const h = href.trim();
  if (h.startsWith('#member-tab:')) {
    return parseMemberTabToken(h.slice('#member-tab:'.length));
  }
  try {
    const url = h.startsWith('http') ? new URL(h) : new URL(h, window.location.origin);
    if (url.hash.startsWith('#member-tab:')) {
      const fromHash = parseMemberTabToken(url.hash.slice('#member-tab:'.length));
      if (fromHash) return fromHash;
    }
    const tab = url.searchParams.get('tab');
    if (tab) return parseMemberTabToken(tab);
  } catch {
    /* ignore */
  }
  return null;
}
