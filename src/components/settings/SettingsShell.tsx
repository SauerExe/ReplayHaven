import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { SECTION_GROUPS, type SectionId } from './sections';
import { t, tp } from '../../i18n';

/** Grouped section navigation: a sticky column on desktop, its own list screen on phones. */
export function SettingsNav({
  current,
  visible,
  badges,
}: {
  current: SectionId | null;
  visible: Record<SectionId, boolean>;
  badges: Partial<Record<SectionId, number>>;
}) {
  return (
    <nav className="st-nav" aria-label={t('settings.nav.label')}>
      {SECTION_GROUPS.map((group) => {
        const sections = group.sections.filter((section) => visible[section.id]);
        if (!sections.length) return null;
        return (
          <div className="st-nav-group" key={group.id}>
            <h2 className="st-nav-heading" id={`st-nav-${group.id}`}>
              {t(group.label)}
            </h2>
            <ul aria-labelledby={`st-nav-${group.id}`}>
              {sections.map((section) => {
                const badge = badges[section.id] ?? 0;
                return (
                  <li key={section.id}>
                    <Link
                      className="st-nav-link"
                      to={`/settings/${section.id}`}
                      aria-current={current === section.id ? 'page' : undefined}
                    >
                      <span className="st-nav-icon" aria-hidden="true">
                        <section.icon size={17} strokeWidth={1.8} />
                      </span>
                      <span className="st-nav-text">{t(section.label)}</span>
                      {badge > 0 && (
                        <span className="st-nav-badge">
                          <span aria-hidden="true">{badge}</span>
                          <span className="sr-only">{tp('settings.nav.requests', badge)}</span>
                        </span>
                      )}
                      <ChevronRight className="st-nav-chevron" size={16} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="st-nav-group">
        <h2 className="st-nav-heading" id="st-nav-help">
          {t('settings.nav.help')}
        </h2>
        <ul aria-labelledby="st-nav-help">
          <li>
            <Link className="st-nav-link" to="/setup">
              <span className="st-nav-icon" aria-hidden="true">
                <BookOpen size={17} strokeWidth={1.8} />
              </span>
              <span className="st-nav-text">{t('settings.nav.setupGuide')}</span>
              <ChevronRight className="st-nav-chevron" size={16} aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}

/**
 * The settings area: navigation plus one section page. On phones without a section only the
 * navigation shows (as a list screen); with a section only the page, with a link back.
 */
export function SettingsShell({
  current,
  phone,
  visible,
  badges,
  children,
}: {
  current: SectionId | null;
  phone: boolean;
  visible: Record<SectionId, boolean>;
  badges: Partial<Record<SectionId, number>>;
  children?: ReactNode;
}) {
  const view = phone ? (current ? 'section' : 'list') : 'split';
  const Title = view === 'list' ? 'h1' : 'p';
  return (
    <div className="page st-shell-page">
      <div className="st-shell" data-view={view}>
        {view !== 'section' && (
          <aside className="st-sidebar">
            <Title className="st-sidebar-title">{t('settings.title')}</Title>
            <SettingsNav current={current} visible={visible} badges={badges} />
          </aside>
        )}
        {view !== 'list' && (
          <div className="st-content">
            {view === 'section' && (
              <Link className="st-back" to="/settings">
                <ChevronLeft size={17} aria-hidden="true" />
                {t('settings.title')}
              </Link>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
