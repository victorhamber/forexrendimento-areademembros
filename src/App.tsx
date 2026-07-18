import { useState, useEffect, useCallback, useRef } from 'react'
import { Home as HomeIcon, User as UserIcon, ShieldCheck, Trophy, GraduationCap, Download, LifeBuoy, type LucideIcon } from 'lucide-react'
import { Home } from './pages/Home'
import { ValidationPanel } from './pages/ValidationPanel'
import { Ranking } from './pages/Ranking'
import { Login } from './pages/Login'
import { Admin } from './pages/Admin'
import { Showcase } from './pages/Showcase'
import { Courses } from './pages/Courses'
import { Library } from './pages/Library'
import { InstallPrompt } from './components/InstallPrompt'
import { useLanguage } from './i18n/useLanguage'
import { t } from './i18n/translations'
import type { Lang } from './i18n/translations'
import {
  clearMemberTabNavigationFromUrl,
  MEMBER_TAB_STORAGE_KEY,
  readMemberTabFromLocation,
} from './lib/memberTabs'
import { applyMemberTheme, writeCachedMemberTheme, type MemberThemeSettings } from './lib/memberTheme'
import {
  checkLocalMemberToken,
  clearMemberSessionStorage,
  memberFetch,
  registerMemberSessionHandler,
} from './lib/memberSession'
import './App.css'

type MemberTab = 'home' | 'courses' | 'downloads' | 'validation' | 'ranking' | 'profile'

const MEMBER_TAB_KEY = MEMBER_TAB_STORAGE_KEY
const MEMBER_TABS: MemberTab[] = ['home', 'courses', 'downloads', 'validation', 'ranking', 'profile']

const SHOW_RANKING = false

function isAdminRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/admin'
}

function readStoredMemberTab(): MemberTab {
  const fromUrl = readMemberTabFromLocation()
  if (fromUrl && MEMBER_TABS.includes(fromUrl as MemberTab)) return fromUrl as MemberTab
  const raw = sessionStorage.getItem(MEMBER_TAB_KEY)
  return raw && MEMBER_TABS.includes(raw as MemberTab) ? (raw as MemberTab) : 'home'
}

function parseShowcaseRoute(pathname: string): { isShowcase: boolean; slug: string | null } {
  const path = pathname.replace(/\/+$/, '')
  const match = path.match(/^\/(vitrine|catalogo|cat[aá]logo)(?:\/([^/]+))?$/i)
  if (!match) return { isShowcase: false, slug: null }
  return { isShowcase: true, slug: match[2] ? decodeURIComponent(match[2]) : null }
}

function parsePublicBuilderRoute(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '')
  if (!path || path === '/') return null
  if (path.startsWith('/admin')) return null
  if (path.startsWith('/api/')) return null
  if (path.startsWith('/uploads/')) return null
  if (/^\/(vitrine|catalogo|cat[aá]logo)(?:\/|$)/i.test(path)) return null
  const rawSlug = path.replace(/^\/+/, '')
  if (!rawSlug || rawSlug.includes('.') || rawSlug.includes('?') || rawSlug.includes('#')) return null
  return decodeURIComponent(rawSlug)
}

function PublicBuilderPage({ slug }: { slug: string }) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetch(`/api/public/links/resolve?slug=${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { found?: boolean; targetUrl?: string }
          if (!active) return
          if (data?.found && data?.targetUrl) {
            setRedirecting(true)
            window.location.replace(data.targetUrl)
            return
          }
        }
        return fetch(`/api/public/pages/${encodeURIComponent(slug)}`).then(async (pagesRes) => {
          const text = await pagesRes.text()
          if (!pagesRes.ok) throw new Error(text || 'Página não encontrada.')
          if (!active) return
          setHtml(text)
        })
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Página não encontrada.')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => { active = false }
  }, [slug])

  // Substitui o documento inteiro — scripts no <head> (pixel, Trajettu, GTM) rodam no contexto real.
  // Antes usava iframe/srcDoc e ferramentas como Meta Pixel Helper não detectavam nada.
  useEffect(() => {
    if (loading || error || !html || redirecting) return
    document.open()
    document.write(html)
    document.close()
  }, [html, loading, error, redirecting])

  if (redirecting) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fff', color: '#111' }}>Redirecionando…</div>
  }
  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fff', color: '#111' }}>Carregando página…</div>
  }
  if (error || !html) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fff', color: '#111', padding: 20, textAlign: 'center' }}>{error || 'Página não encontrada.'}</div>
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fff', color: '#111' }}>
      Carregando página…
    </div>
  )
}

function App() {
  const directBuilderSlug = parsePublicBuilderRoute(window.location.pathname)
  if (directBuilderSlug) {
    return <PublicBuilderPage slug={directBuilderSlug} />
  }

  if (isAdminRoute(window.location.pathname)) {
    return <Admin />
  }

  const { lang, setLang } = useLanguage()
  const tr = t(lang)

  const [routePathname, setRoutePathname] = useState(() => window.location.pathname)
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem('contentpro_userId'))
  const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem('contentpro_userEmail'))
  const [userName, setUserName] = useState<string | null>(() => localStorage.getItem('contentpro_userName'))
  const [activeTab, setActiveTabState] = useState<MemberTab>(readStoredMemberTab)
  const [mountedTabs, setMountedTabs] = useState<Set<MemberTab>>(() => new Set([readStoredMemberTab()]))
  const profileLoadedRef = useRef(false)
  const sessionAlertShownRef = useRef(false)
  const setActiveTab = (tab: MemberTab) => {
    setActiveTabState(tab)
    sessionStorage.setItem(MEMBER_TAB_KEY, tab)
    clearMemberTabNavigationFromUrl()
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }
  const [showShowcase, setShowShowcase] = useState(false)
  const [showcaseSlug, setShowcaseSlug] = useState<string | null>(null)
  const [supportUrl, setSupportUrl] = useState('')

  const [isLoading, setIsLoading] = useState(true)
  const [pendingCourseSlug, setPendingCourseSlug] = useState<string | null>(null)

  const clearPendingCourseSlug = useCallback(() => setPendingCourseSlug(null), [])

  const authHeaders = (json = false): Record<string, string> => {
    const h: Record<string, string> = {}
    if (userId) h['x-user-id'] = userId
    const tok = localStorage.getItem('contentpro_token')
    if (tok) h['Authorization'] = `Bearer ${tok}`
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  const handleLogin = (id: string, email: string) => {
    setUserId(id)
    setUserEmail(email)
    localStorage.setItem('contentpro_userId', id)
    localStorage.setItem('contentpro_userEmail', email)
  }

  const handleLogout = useCallback(() => {
    setUserId(null)
    setUserEmail(null)
    setUserName(null)
    clearMemberSessionStorage()
    profileLoadedRef.current = false
    sessionAlertShownRef.current = false
  }, [])

  const handleSessionExpired = useCallback(() => {
    const stillLoggedIn = userId || localStorage.getItem('contentpro_userId')
    if (!stillLoggedIn) return
    if (!sessionAlertShownRef.current) {
      sessionAlertShownRef.current = true
      alert(tr.session_expired)
    }
    handleLogout()
  }, [userId, tr.session_expired, handleLogout])

  useEffect(() => registerMemberSessionHandler(handleSessionExpired), [handleSessionExpired])

  const fetchData = () => {
    if (!userId) {
      setIsLoading(false)
      return
    }
    if (!checkLocalMemberToken()) return
    const showInitialSpinner = !profileLoadedRef.current
    if (showInitialSpinner) setIsLoading(true)
    memberFetch('/api/profile', { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) return
        const profile = await res.json()
        if (profile?.name) {
          setUserName(profile.name)
          localStorage.setItem('contentpro_userName', profile.name)
        }

        if (profile?.country) {
          const isSpanishCountry = ['AR','BO','CL','CO','CR','CU','DO','EC','SV','GT','HN','MX','NI','PA','PY','PE','PR','ES','UY','VE','GQ'].includes(profile.country);
          const targetLang: Lang = isSpanishCountry ? 'es' : 'pt';

          if (lang !== targetLang) {
            console.log(`[i18n] Auto-detecting lang from country ${profile.country} -> ${targetLang}`);
            setLang(targetLang);
          }
        }
      })
      .catch(console.error)
      .finally(() => {
        profileLoadedRef.current = true
        setIsLoading(false)
      })
  }

  useEffect(() => {
    profileLoadedRef.current = false
    fetchData()
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const revalidateSession = () => {
      if (document.visibilityState === 'hidden') return
      if (!checkLocalMemberToken()) return
      void memberFetch('/api/profile', { headers: authHeaders() })
    }
    document.addEventListener('visibilitychange', revalidateSession)
    window.addEventListener('focus', revalidateSession)
    return () => {
      document.removeEventListener('visibilitychange', revalidateSession)
      window.removeEventListener('focus', revalidateSession)
    }
  }, [userId])

  useEffect(() => {
    const onPopState = () => setRoutePathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qLang = params.get('lang')
    if (qLang === 'pt' || qLang === 'es') setLang(qLang)
  }, [setLang])

  useEffect(() => {
    const tab = readMemberTabFromLocation()
    if (tab && MEMBER_TABS.includes(tab as MemberTab)) {
      setActiveTabState(tab as MemberTab)
      sessionStorage.setItem(MEMBER_TAB_KEY, tab)
    }
    clearMemberTabNavigationFromUrl()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/public/member-hero')
      .then((r) => r.json())
      .then((d: { supportUrl?: string | null }) => {
        if (cancelled) return
        setSupportUrl(String(d?.supportUrl || '').trim())
      })
      .catch(() => {
        if (!cancelled) setSupportUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/public/member-theme')
      .then((r) => r.json())
      .then((data: MemberThemeSettings) => {
        if (cancelled) return
        const theme = data || {}
        applyMemberTheme(theme)
        writeCachedMemberTheme(theme)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const parsed = parseShowcaseRoute(routePathname)
    if (parsed.isShowcase) {
      setShowShowcase(true)
      setShowcaseSlug(parsed.slug)
    } else {
      setShowShowcase(false)
      setShowcaseSlug(null)
    }
  }, [routePathname])

  const navigate = (pathname: string) => {
    if (window.location.pathname === pathname) return
    window.history.pushState({}, '', pathname)
    setRoutePathname(pathname)
  }

  const handleProfileUpdate = (newName: string) => {
    setUserName(newName)
    localStorage.setItem('contentpro_userName', newName)
  }

  if (showShowcase) {
    return <Showcase lang={lang} slug={showcaseSlug} onBack={() => navigate('/')} />
  }

  if (!userId) {
    return <Login onLogin={handleLogin} lang={lang} setLang={setLang} />
  }

  const memberNavItems: { tab: MemberTab; Icon: LucideIcon; label: string }[] = [
    { tab: 'home', Icon: HomeIcon, label: tr.nav_home },
    { tab: 'courses', Icon: GraduationCap, label: tr.nav_courses },
    { tab: 'downloads', Icon: Download, label: tr.nav_downloads },
    { tab: 'validation', Icon: ShieldCheck, label: tr.nav_validation },
    ...(SHOW_RANKING ? [{ tab: 'ranking' as const, Icon: Trophy, label: tr.nav_ranking }] : []),
    { tab: 'profile', Icon: UserIcon, label: tr.nav_profile },
  ]
  const profileNav = memberNavItems.find((x) => x.tab === 'profile')
  const coreNav = memberNavItems.filter((x) => x.tab !== 'profile')

  const openSupport = () => {
    const url = supportUrl.trim()
    if (!url) {
      alert(tr.support_not_configured)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const currentSectionLabel =
    activeTab === 'home'
      ? tr.nav_home
      : activeTab === 'courses'
        ? tr.nav_courses
        : activeTab === 'downloads'
          ? tr.nav_downloads
        : activeTab === 'validation'
            ? tr.nav_validation
            : activeTab === 'ranking'
              ? tr.nav_ranking
              : tr.nav_profile

  return (
    <div className="app-container app-member-shell">
        <div className="app-member-layout">
          {activeTab !== 'home' && (
            <header className="member-topbar" role="banner">
              <div className="member-topbar-inner">
                <span className="member-topbar-badge">{tr.member_area_badge}</span>
                <span className="member-topbar-section">{currentSectionLabel}</span>
              </div>
            </header>
          )}

          <aside className="member-sidebar" aria-label={tr.member_sidebar_hint}>
            <div className="member-sidebar-brand">
              <img
                src="/logo.png"
                alt={tr.home_brand_logo_alt}
                className="member-sidebar-logo"
                width={180}
                height={96}
                decoding="async"
              />
            </div>
            <nav className="member-sidebar-nav">
              {coreNav.map(({ tab, Icon, label }) => (
                <button
                  key={tab}
                  type="button"
                  className={`member-sidebar-item ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  <Icon aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                className="member-sidebar-item"
                onClick={openSupport}
              >
                <LifeBuoy aria-hidden />
                <span>{tr.nav_support}</span>
              </button>
              {profileNav && (
                <button
                  type="button"
                  className={`member-sidebar-item ${activeTab === profileNav.tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(profileNav.tab)}
                >
                  <profileNav.Icon aria-hidden />
                  <span>{profileNav.label}</span>
                </button>
              )}
            </nav>
          </aside>

          <div className="member-body">
            <main className={`app-main${activeTab === 'home' ? ' app-main--netflix-home' : ''}`}>
              {mountedTabs.has('home') && (
                <div className="member-tab-panel" hidden={activeTab !== 'home'}>
                  <Home
                    onOpenCourse={slug => {
                      setPendingCourseSlug(slug)
                      setActiveTab('courses')
                    }}
                    isLoading={isLoading}
                    userEmail={userEmail}
                    userName={userName}
                    lang={lang}
                    setLang={setLang}
                    authHeaders={authHeaders}
                  />
                </div>
              )}
              {mountedTabs.has('courses') && userId && (
                <div className="member-tab-panel" hidden={activeTab !== 'courses'}>
                  <Courses
                    userId={userId}
                    lang={lang}
                    initialSlug={pendingCourseSlug}
                    onInitialSlugConsumed={clearPendingCourseSlug}
                    authHeaders={authHeaders}
                    onNavigateMemberTab={(tab) => setActiveTab(tab)}
                  />
                </div>
              )}
              {mountedTabs.has('downloads') && (
                <div className="member-tab-panel" hidden={activeTab !== 'downloads'}>
                  <Library lang={lang} authHeaders={authHeaders} />
                </div>
              )}
              {mountedTabs.has('validation') && userId && (
                <div className="member-tab-panel" hidden={activeTab !== 'validation'}>
                  <ValidationPanel userId={userId} lang={lang} userEmail={userEmail} authHeaders={authHeaders} />
                </div>
              )}
              {mountedTabs.has('ranking') && (
                <div className="member-tab-panel" hidden={activeTab !== 'ranking'}>
                  <Ranking lang={lang} />
                </div>
              )}
              {mountedTabs.has('profile') && (
                <div className="member-tab-panel" hidden={activeTab !== 'profile'}>
                  <ProfilePage
                    userEmail={userEmail}
                    userName={userName}
                    lang={lang}
                    onLogout={handleLogout}
                    onProfileUpdate={handleProfileUpdate}
                    authHeaders={authHeaders}
                  />
                </div>
              )}
            </main>

            <nav className="bottom-nav" aria-label={tr.member_sidebar_hint}>
              {coreNav.map(({ tab, Icon, label }) => (
                <button
                  key={tab}
                  type="button"
                  className={`bottom-nav-item ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  <Icon aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                className="bottom-nav-item"
                onClick={openSupport}
              >
                <LifeBuoy aria-hidden />
                <span>{tr.nav_support}</span>
              </button>
              {profileNav && (
                <button
                  type="button"
                  className={`bottom-nav-item ${activeTab === profileNav.tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(profileNav.tab)}
                >
                  <profileNav.Icon aria-hidden />
                  <span>{profileNav.label}</span>
                </button>
              )}
            </nav>
          </div>
        </div>
      <InstallPrompt lang={lang} />
    </div>
  )
}

// ===== PROFILE PAGE COMPONENT =====
function ProfilePage({ userEmail, userName, lang, onLogout, onProfileUpdate, authHeaders }: {
  userEmail: string | null; userName: string | null;
  lang: Lang; onLogout: () => void; onProfileUpdate: (name: string) => void;
  authHeaders: (json?: boolean) => Record<string, string>;
}) {
  const tr = t(lang)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(userName || '')
  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPass, setCurrentPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [saving, setSaving] = useState(false)

  const displayName = userName || userEmail?.split('@')[0] || tr.profile_user_fallback

  const handleSaveName = async () => {
    setSaving(true)
    try {
      const res = await memberFetch('/api/profile', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ name: nameValue })
      })
      if (res.ok) {
        onProfileUpdate(nameValue)
        setEditingName(false)
        alert(tr.profile_name_updated)
      }
    } catch { alert(tr.profile_save_error) }
    finally { setSaving(false) }
  }

  const handleChangePassword = async () => {
    if (!currentPass || !newPass) { alert(tr.profile_fill_fields); return }
    setSaving(true)
    try {
      const res = await memberFetch('/api/profile/password', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
      })
      const data = await res.json()
      if (res.ok) {
        alert(tr.profile_password_changed)
        setChangingPassword(false); setCurrentPass(''); setNewPass('')
      } else {
        alert(data.error || tr.profile_password_error)
      }
    } catch { alert(tr.profile_connection_error) }
    finally { setSaving(false) }
  }

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-avatar">
          {displayName[0].toUpperCase()}
        </div>
        {editingName ? (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '8px' }}>
            <input 
              className="profile-edit-input" value={nameValue} onChange={e => setNameValue(e.target.value)}
              placeholder={tr.profile_name_placeholder} autoFocus
            />
            <button className="profile-save-btn" onClick={handleSaveName} disabled={saving}>{tr.profile_save}</button>
            <button className="profile-cancel-btn" onClick={() => setEditingName(false)}>✕</button>
          </div>
        ) : (
          <h2 className="profile-name" onClick={() => { setEditingName(true); setNameValue(userName || '') }} style={{ cursor: 'pointer' }}>
            {displayName} <span style={{ fontSize: '13px', color: 'var(--accent-primary)' }}>✏️</span>
          </h2>
        )}
        <p className="profile-stats">{tr.profile_area_hint}</p>
      </div>
      
      <div className="profile-section">
        <h3>{tr.profile_section_account}</h3>
        <div className="profile-item">
          <span>{tr.profile_email}</span>
          <span className="profile-value">{userEmail}</span>
        </div>
        <div className="profile-item">
          <span>{tr.profile_name}</span>
          <span className="profile-value">{userName || tr.profile_name_undefined}</span>
        </div>
        <div className="profile-item" style={{ cursor: 'pointer' }} onClick={() => setChangingPassword(!changingPassword)}>
          <span>{tr.profile_change_password}</span>
          <span className="profile-value" style={{ color: 'var(--accent-primary)' }}>{changingPassword ? '▲' : '▶'}</span>
        </div>
        {changingPassword && (
          <div style={{ padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input className="profile-edit-input" type="password" placeholder={tr.profile_password_current} value={currentPass} onChange={e => setCurrentPass(e.target.value)} />
            <input className="profile-edit-input" type="password" placeholder={tr.profile_password_new} value={newPass} onChange={e => setNewPass(e.target.value)} />
            <button className="profile-save-btn" onClick={handleChangePassword} disabled={saving}>
              {saving ? tr.profile_saving : tr.profile_confirm_change}
            </button>
          </div>
        )}
      </div>

      <div className="profile-section">
        <h3>{tr.profile_section_about}</h3>
        <div className="profile-item">
          <span>{tr.profile_version}</span>
          <span className="profile-value">1.0.0</span>
        </div>
      </div>

      <button className="logout-btn" onClick={onLogout}>
        {tr.profile_logout}
      </button>
    </div>
  )
}

export default App
