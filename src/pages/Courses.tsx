import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ExternalLink, GraduationCap, Lock, Play } from 'lucide-react';
import type { Lang } from '../i18n/translations';
import { t } from '../i18n/translations';
import { parseVideoUrl } from '../lib/videoEmbed';
import { readEadResumeState, writeEadResumeState } from '../lib/lessonProgress';
import { VideoPlayer } from '../components/VideoPlayer';
import { LessonBodyContent } from '../components/LessonBodyContent';
import type { MemberTabLink } from '../lib/memberTabs';
import '../components/VideoPlayer.css';
import './Courses.css';

type Lesson = {
  id: string;
  title: string;
  sortOrder: number;
  contentId: string | null;
  videoUrl?: string | null;
  bodyText?: string | null;
  actionLabel?: string | null;
  actionUrl?: string | null;
};
type Module = { id: string; title: string; sortOrder: number; lessons: Lesson[] };
type Course = {
  id: string;
  title: string;
  slug: string;
  coverUrl?: string | null;
  modules: Module[];
  isPublic?: boolean;
  hasAccess?: boolean;
  salesPageUrl?: string | null;
  memberPageUrl?: string | null;
  requiredSystemIds?: string[];
};

type ProgressMap = Record<string, { completed: boolean; percent: number }>;

function courseLessonStats(course: Course, progress: ProgressMap) {
  const lessons = course.modules.flatMap(m => m.lessons);
  const total = lessons.length;
  if (!total) return { pct: 0, done: 0, total: 0 };
  const done = lessons.filter(l => progress[l.id]?.completed).length;
  return { pct: Math.round((done / total) * 100), done, total };
}

function firstSuggestedLesson(course: Course, progress: ProgressMap): Lesson | null {
  const lessons = course.modules.flatMap((m) => m.lessons);
  if (!lessons.length) return null;
  const firstPending = lessons.find((l) => !progress[l.id]?.completed);
  return firstPending || lessons[0] || null;
}

interface CoursesProps {
  userId: string;
  lang: Lang;
  /** Quando vindo da home: abre o curso com este slug e dispara consume uma vez. */
  initialSlug?: string | null;
  onInitialSlugConsumed?: () => void;
  authHeaders?: (json?: boolean) => Record<string, string>;
  onNavigateMemberTab?: (tab: MemberTabLink) => void;
}

export function Courses({ userId, lang, initialSlug, onInitialSlugConsumed, authHeaders, onNavigateMemberTab }: CoursesProps) {
  const tr = t(lang);
  const [courses, setCourses] = useState<Course[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loading, setLoading] = useState(true);

  const initialResume = readEadResumeState();
  const [activeCourseSlug, setActiveCourseSlug] = useState(() => initialResume?.courseSlug ?? '');
  const [activeLessonId, setActiveLessonId] = useState(() => initialResume?.lessonId ?? '');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const buildHeaders = (): Record<string, string> => {
    if (authHeaders) return authHeaders();
    const h: Record<string, string> = { 'x-user-id': userId };
    const tok = localStorage.getItem('contentpro_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    return h;
  };

  useEffect(() => {
    fetch('/api/public/courses', { headers: buildHeaders() })
      .then(r => r.json())
      .then((data: Course[]) => setCourses(Array.isArray(data) ? data : []))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const slug = initialSlug?.trim();
    if (!slug || !courses.length) return;
    const target = courses.find(c => c.slug === slug);
    if (!target) return;
    if (target.hasAccess === false) {
      const url = target.salesPageUrl;
      if (url) {
        window.location.href = url;
      } else {
        alert('Este curso é exclusivo para clientes da oferta. Você ainda não tem licença para acessá-lo.');
      }
      onInitialSlugConsumed?.();
      return;
    }
    const memberUrl = target.memberPageUrl?.trim();
    if (memberUrl) {
      window.location.href = memberUrl;
      onInitialSlugConsumed?.();
      return;
    }
    setActiveCourseSlug(slug);
    onInitialSlugConsumed?.();
  }, [initialSlug, courses, onInitialSlugConsumed]);

  useEffect(() => {
    if (!userId) return;
    fetch('/api/me/course-progress', { headers: buildHeaders() })
      .then(r => r.json())
      .then((data: { progress?: { lessonId: string; completed: boolean; percent: number }[] }) => {
        const m: ProgressMap = {};
        for (const p of data.progress || []) {
          m[p.lessonId] = { completed: p.completed, percent: p.percent };
        }
        setProgress(m);
      })
      .catch(() => {});
  }, [userId, courses.length]);

  const allCourseLessonsRef = useRef<Lesson[]>([]);
  const lessonCompleteGuardRef = useRef<Set<string>>(new Set());
  const lessonResumeAppliedRef = useRef<string | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [videoResumePercent, setVideoResumePercent] = useState(0);

  const saveProgress = useCallback(
    (lessonId: string, patch: { completed?: boolean; percent?: number }) => {
      setProgress((prev) => {
        const cur = prev[lessonId];
        let nextPercent: number;
        if (patch.completed === true) {
          nextPercent = 100;
        } else if (patch.percent != null) {
          nextPercent =
            patch.completed === false
              ? patch.percent
              : Math.max(cur?.percent ?? 0, patch.percent);
        } else {
          nextPercent = cur?.percent ?? 0;
        }
        const nextCompleted = patch.completed ?? cur?.completed ?? false;
        return {
          ...prev,
          [lessonId]: { completed: nextCompleted, percent: nextPercent },
        };
      });
      const h = { ...buildHeaders(), 'Content-Type': 'application/json' };
      const body: { lessonId: string; completed?: boolean; percent?: number } = { lessonId };
      if (patch.completed != null) body.completed = patch.completed;
      if (patch.percent != null) body.percent = patch.percent;
      if (patch.completed === true) body.percent = 100;
      void fetch('/api/me/lesson-progress', {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
      });
    },
    [userId]
  );

  const markLesson = (lessonId: string, completed: boolean) => {
    if (completed) lessonCompleteGuardRef.current.add(lessonId);
    else lessonCompleteGuardRef.current.delete(lessonId);
    saveProgress(lessonId, { completed, percent: completed ? 100 : 0 });
  };

  const handleLessonComplete = useCallback(
    (lessonId: string) => {
      if (lessonCompleteGuardRef.current.has(lessonId)) return;
      lessonCompleteGuardRef.current.add(lessonId);
      saveProgress(lessonId, { completed: true, percent: 100 });
    },
    [saveProgress]
  );

  useEffect(() => {
    if (!activeLessonId) return;
    const p = progressRef.current[activeLessonId];
    const done = !!p?.completed;
    setVideoResumePercent(done ? 0 : (p?.percent ?? 0));
  }, [activeLessonId]);

  const handleVideoProgress = useCallback(
    (lessonId: string, percent: number) => {
      saveProgress(lessonId, { percent });
    },
    [saveProgress]
  );

  const activeCourse = useMemo(() => {
    if (!activeCourseSlug) return null;
    return courses.find(c => c.slug === activeCourseSlug) || null;
  }, [courses, activeCourseSlug]);

  const activeLesson = useMemo(() => {
    if (!activeCourse || !activeLessonId) return null;
    for (const m of activeCourse.modules) {
      const found = m.lessons.find(l => l.id === activeLessonId);
      if (found) return found;
    }
    return null;
  }, [activeCourse, activeLessonId]);

  const activeLessonVideo = useMemo(
    () => parseVideoUrl(activeLesson?.videoUrl),
    [activeLesson?.videoUrl]
  );

  const allCourseLessons = useMemo(() => {
    if (!activeCourse) return [];
    return activeCourse.modules.flatMap(m => m.lessons);
  }, [activeCourse]);

  const currentLessonIndex = allCourseLessons.findIndex(l => l.id === activeLessonId);
  const prevLesson = currentLessonIndex > 0 ? allCourseLessons[currentLessonIndex - 1] : null;
  const nextLesson = currentLessonIndex >= 0 && currentLessonIndex < allCourseLessons.length - 1 ? allCourseLessons[currentLessonIndex + 1] : null;

  const toggleModule = (modId: string) => {
    setExpandedModules(prev => {
      const n = new Set(prev);
      if (n.has(modId)) n.delete(modId);
      else n.add(modId);
      return n;
    });
  };

  useEffect(() => {
    if (activeCourse) {
      setExpandedModules(new Set(activeCourse.modules.map(m => m.id)));
    }
  }, [activeCourse?.id]);

  const openLesson = (lessonId: string) => {
    lessonCompleteGuardRef.current.delete(lessonId);
    setActiveLessonId(lessonId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    allCourseLessonsRef.current = allCourseLessons;
  }, [allCourseLessons]);

  useEffect(() => {
    if (!courses.length || initialSlug?.trim()) return;
    const saved = readEadResumeState();
    if (!saved?.courseSlug || activeCourseSlug) return;
    const target = courses.find((c) => c.slug === saved.courseSlug);
    if (target && target.hasAccess !== false) {
      setActiveCourseSlug(saved.courseSlug);
    }
  }, [courses, initialSlug, activeCourseSlug]);

  useEffect(() => {
    if (activeCourseSlug && activeLessonId) {
      writeEadResumeState({ courseSlug: activeCourseSlug, lessonId: activeLessonId });
    }
  }, [activeCourseSlug, activeLessonId]);

  useEffect(() => {
    lessonResumeAppliedRef.current = null;
    lessonCompleteGuardRef.current.clear();
  }, [activeCourse?.id]);

  useEffect(() => {
    if (!activeCourse || !allCourseLessons.length) return;
    if (activeLessonId && allCourseLessons.some((l) => l.id === activeLessonId)) return;

    const saved = readEadResumeState();
    const resumeKey = saved ? `${activeCourse.slug}:${saved.lessonId}` : '';
    if (
      saved?.courseSlug === activeCourse.slug &&
      saved.lessonId &&
      allCourseLessons.some((l) => l.id === saved.lessonId) &&
      lessonResumeAppliedRef.current !== resumeKey
    ) {
      lessonResumeAppliedRef.current = resumeKey;
      setActiveLessonId(saved.lessonId);
      return;
    }

    const next = firstSuggestedLesson(activeCourse, progress);
    if (next) setActiveLessonId(next.id);
  }, [activeCourse?.id, activeCourse?.slug, allCourseLessons, activeLessonId, progress]);

  // --- LOADING ---
  if (loading) {
    return (
      <div className="courses-page courses-page--loading" aria-busy="true" aria-label={tr.courses_loading}>
        <div className="courses-hub-skeleton" aria-hidden />
        <div className="courses-grid courses-grid--skeleton" aria-hidden>
          {[1, 2, 3].map((i) => (
            <div key={i} className="course-tile course-tile--skeleton" />
          ))}
        </div>
      </div>
    );
  }

  // --- EMPTY ---
  if (!courses.length) {
    return (
      <div className="courses-page courses-page--empty">
        <GraduationCap size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
        <h1 className="courses-empty-title">{tr.nav_courses}</h1>
        <p className="courses-empty-desc">{tr.courses_empty}</p>
      </div>
    );
  }

  // --- COURSE DETAIL (modules + lessons sidebar) ---
  if (activeCourse) {
    const stats = courseLessonStats(activeCourse, progress);
    const lessonDone = !!activeLesson && !!progress[activeLesson.id]?.completed;
    const lessonOrder = new Map<string, number>();
    allCourseLessons.forEach((l, idx) => lessonOrder.set(l.id, idx + 1));
    const suggestedLesson = firstSuggestedLesson(activeCourse, progress);
    return (
      <div className="courses-page">
        <section className="course-detail-header">
          <h1 className="course-detail-title">{activeCourse.title}</h1>
          <p className="course-detail-sub">
            {stats.done} de {stats.total} aulas concluídas · {stats.pct}%
          </p>
          <div className="course-detail-bar">
            <div style={{ width: `${stats.pct}%` }} />
          </div>
        </section>

        <section className="course-player-layout">
          <aside className="course-player-sidebar">
            {activeCourse.modules.map((mod) => {
              const isOpen = expandedModules.has(mod.id);
              const modDone = mod.lessons.filter((l) => progress[l.id]?.completed).length;
              return (
                <div key={mod.id} className="course-module-block">
                  <button
                    type="button"
                    className={`course-module-header ${isOpen ? 'course-module-header--open' : ''}`}
                    onClick={() => toggleModule(mod.id)}
                  >
                    <div className="course-module-header-left">
                      {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <span className="course-module-header-title">{mod.title}</span>
                    </div>
                    <span className="course-module-header-count">
                      {modDone}/{mod.lessons.length}
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="course-lesson-list">
                      {mod.lessons.map((les) => {
                        const done = !!progress[les.id]?.completed;
                        const isSuggested = suggestedLesson?.id === les.id;
                        const isActive = activeLesson?.id === les.id;
                        return (
                          <li key={les.id} className="course-lesson-item">
                            <button
                              type="button"
                              className={`course-lesson-btn ${isSuggested ? 'course-lesson-btn--suggested' : ''} ${
                                isActive ? 'course-lesson-btn--active' : ''
                              }`}
                              onClick={() => openLesson(les.id)}
                            >
                              <span className={`course-lesson-check ${done ? 'course-lesson-check--done' : ''}`}>
                                {done ? <Check size={12} /> : <Play size={10} />}
                              </span>
                              <span className="course-lesson-name">{les.title}</span>
                              {isActive && <span className="course-lesson-tag">Assistindo</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </aside>

          <div className="course-player-main">
            {activeLesson ? (
              <div className="lesson-page">
                <div className="lesson-content">
                  {activeLessonVideo ? (
                    <div className="lesson-video">
                      <VideoPlayer
                        key={activeLesson.id}
                        video={activeLessonVideo}
                        title={activeLesson.title}
                        initialPercent={videoResumePercent}
                        onProgress={(pct) => handleVideoProgress(activeLesson.id, pct)}
                        onEnded={() => handleLessonComplete(activeLesson.id)}
                      />
                    </div>
                  ) : (
                    <div className="lesson-video lesson-video--empty">Sem vídeo nesta aula.</div>
                  )}

                  <div className="lesson-info">
                    <span className="course-lesson-tag">Aula {lessonOrder.get(activeLesson.id) || '-'}</span>
                    <h1 className="lesson-info-title">{activeLesson.title}</h1>

                    {activeLesson.bodyText && (
                      <LessonBodyContent
                        bodyText={activeLesson.bodyText}
                        onNavigateMemberTab={onNavigateMemberTab}
                      />
                    )}

                    {activeLesson.actionUrl && (
                      <a className="lesson-info-action" href={activeLesson.actionUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={16} />
                        {activeLesson.actionLabel || 'Acessar link'}
                      </a>
                    )}

                    <div className="lesson-info-footer">
                      <button
                        type="button"
                        className={`lesson-mark-btn ${lessonDone ? 'lesson-mark-btn--done' : ''}`}
                        onClick={() => markLesson(activeLesson.id, !lessonDone)}
                      >
                        <Check size={16} />
                        {lessonDone ? 'Aula concluída' : 'Marcar como concluída'}
                      </button>

                      {prevLesson && (
                        <button type="button" className="lesson-next-btn" onClick={() => openLesson(prevLesson.id)}>
                          Aula anterior
                        </button>
                      )}
                      {nextLesson && (
                        <button type="button" className="lesson-next-btn" onClick={() => openLesson(nextLesson.id)}>
                          Próxima aula
                        </button>
                      )}
                    </div>

                  </div>
                </div>
              </div>
            ) : (
              <div className="lesson-video lesson-video--empty">Selecione uma aula na coluna da esquerda.</div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // --- HUB (course cards) ---
  return (
    <div className="courses-page">
      <div className="courses-hub-header">
        <GraduationCap size={22} />
        <div>
          <h1 className="courses-hub-title">Meus cursos</h1>
          <p className="courses-hub-sub">Selecione um curso para começar a estudar.</p>
        </div>
      </div>

      <section className="courses-grid">
        {courses.map(course => {
          const st = courseLessonStats(course, progress);
          const locked = course.hasAccess === false;
          const handleClick = () => {
            if (!locked) {
              const memberUrl = course.memberPageUrl?.trim();
              if (memberUrl) {
                window.location.href = memberUrl;
                return;
              }
              setActiveCourseSlug(course.slug);
              return;
            }
            const url = course.salesPageUrl;
            if (url) {
              window.location.href = url;
            } else {
              alert('Este curso é exclusivo para clientes da oferta. Você ainda não tem licença para acessá-lo.');
            }
          };
          return (
            <button
              key={course.id}
              type="button"
              className={`course-tile${locked ? ' course-tile--locked' : ''}`}
              onClick={handleClick}
              aria-disabled={locked || undefined}
            >
              {course.coverUrl ? (
                <img
                  src={course.coverUrl}
                  alt={course.title}
                  className="course-tile-cover"
                  style={locked ? { filter: 'grayscale(100%)' } : undefined}
                />
              ) : (
                <div className="course-tile-cover course-tile-cover--placeholder">
                  <GraduationCap size={32} />
                </div>
              )}
              {locked && (
                <div className="course-tile-lock" aria-hidden>
                  <Lock size={22} />
                </div>
              )}
              <div className="course-tile-body">
                <div className="course-tile-title">{course.title}</div>
                <div className="course-tile-meta">
                  {locked
                    ? 'Conteúdo exclusivo · liberar acesso'
                    : `${course.modules.length} módulos · ${st.total} aulas`}
                </div>
                {!locked && (
                  <>
                    <div className="course-tile-bar">
                      <div style={{ width: `${st.pct}%` }} />
                    </div>
                    <div className="course-tile-footer">
                      <span className="course-tile-pct">{st.pct}% concluído</span>
                      <span className="course-tile-cta">Acessar</span>
                    </div>
                  </>
                )}
                {locked && (
                  <div className="course-tile-footer">
                    <span className="course-tile-pct">Sem licença</span>
                    <span className="course-tile-cta">Ver oferta</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </section>
    </div>
  );
}
