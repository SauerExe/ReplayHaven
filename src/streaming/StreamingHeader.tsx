import { useEffect, useRef, useState } from 'react';
import { House, Layers, LayoutGrid, Monitor, Search, Upload, UserRound, X } from 'lucide-react';
import { t, type MessageKey } from '../i18n';
import { BrandMark } from './icons';
import { linkHandler, type Navigate } from './links';
import { withUploader } from './rows';

/** `path` identifies the item (see `active`); `href` may carry the person filter. */
const nav = (
  devicesHref: string,
  uploader: string,
): { path: string; href: string; label: MessageKey; icon: typeof House }[] => [
  { path: '/', href: withUploader('/', uploader), label: 'stream.nav.home', icon: House },
  {
    path: '/library',
    href: withUploader('/library', uploader),
    label: 'stream.nav.library',
    icon: LayoutGrid,
  },
  { path: '/collections', href: '/collections', label: 'stream.nav.collections', icon: Layers },
  { path: devicesHref, href: devicesHref, label: 'stream.nav.devices', icon: Monitor },
];

export interface StreamingHeaderProps {
  /** href of the active menu item. */
  active?: string;
  onNavigate?: Navigate;
  onSearch?: (query: string) => void;
  onAddClip?: () => void;
  profileHref?: string;
  /** Target of the "Devices" item: recording PCs for admins, own devices for users. */
  devicesHref?: string;
  /** Person filter (`?by=`) that "Home" and "Library" keep, so both show the same person. */
  uploader?: string;
}

export function StreamingHeader({
  active = '/',
  onNavigate,
  onSearch,
  onAddClip,
  profileHref = '/settings',
  devicesHref = '/settings/pcs',
  uploader = '',
}: StreamingHeaderProps) {
  const NAV = nav(devicesHref, uploader);
  const [solid, setSolid] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const update = () => setSolid(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  function closeSearch() {
    setSearching(false);
    toggleRef.current?.focus();
  }

  return (
    <>
      <header className={`stream stream-header${solid || searching ? ' is-solid' : ''}`}>
        <a
          className="stream-brand"
          href="/"
          aria-label={t('stream.nav.brand')}
          onClick={linkHandler(onNavigate, '/')}
        >
          <BrandMark />
          <span className="stream-brand-word" aria-hidden="true">
            Replay<span>Haven</span>
          </span>
        </a>
        <nav className="stream-nav" aria-label={t('stream.nav.main')}>
          {NAV.map((item) => (
            <a
              key={item.path}
              href={item.href}
              aria-current={active === item.path ? 'page' : undefined}
              onClick={linkHandler(onNavigate, item.href)}
            >
              {t(item.label)}
            </a>
          ))}
        </nav>
        <div className="stream-header-tools">
          {onSearch && (
            <form
              role="search"
              className="stream-search"
              data-open={searching}
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim()) onSearch(query.trim());
              }}
            >
              {searching && (
                <input
                  // Search opens on request; focus then belongs in the field.
                  autoFocus
                  type="search"
                  className="stream-search-input"
                  aria-label={t('stream.search.label')}
                  placeholder={t('stream.search.placeholder')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      closeSearch();
                    }
                  }}
                />
              )}
              <button
                ref={toggleRef}
                type="button"
                className="stream-icon-button"
                aria-label={searching ? t('stream.search.close') : t('stream.search.open')}
                aria-expanded={searching}
                onClick={() => (searching ? closeSearch() : setSearching(true))}
              >
                {searching ? (
                  <X size={22} aria-hidden="true" />
                ) : (
                  <Search size={22} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            </form>
          )}
          {onAddClip && (
            <button
              type="button"
              className="stream-add"
              aria-label={t('stream.home.addClip')}
              onClick={onAddClip}
            >
              <Upload size={18} strokeWidth={2} aria-hidden="true" />
              <span>{t('stream.home.addClip')}</span>
            </button>
          )}
          <a
            className="stream-profile"
            href={profileHref}
            aria-label={t('stream.nav.profile')}
            onClick={linkHandler(onNavigate, profileHref)}
          >
            <UserRound size={20} strokeWidth={2} aria-hidden="true" />
          </a>
        </div>
      </header>
      <nav className="stream stream-tabbar" aria-label={t('stream.nav.main')}>
        {NAV.map((item) => (
          <a
            key={item.path}
            href={item.href}
            aria-current={active === item.path ? 'page' : undefined}
            onClick={linkHandler(onNavigate, item.href)}
          >
            <item.icon size={24} strokeWidth={2} aria-hidden="true" />
            {t(item.label)}
          </a>
        ))}
      </nav>
    </>
  );
}
