import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Folder,
  Grid2X2,
  Home,
  Menu as MenuIcon,
  Monitor,
  Search,
  Settings,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useActions } from './Actions';
import { useVault } from '../data/store';
const scrollPositions = new Map<string, number>();
function RouteScroll() {
  const location = useLocation();
  const navigation = useNavigationType();
  const previous = useRef(location.pathname);
  useLayoutEffect(() => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (navigation === 'POP' && scrollPositions.has(location.key))
      window.scrollTo(0, scrollPositions.get(location.key)!);
    else if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else if (previous.current !== location.pathname) window.scrollTo(0, 0);
    previous.current = location.pathname;
    const save = () => scrollPositions.set(location.key, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      window.removeEventListener('scroll', save);
    };
  }, [location.key, location.pathname, location.hash, navigation]);
  return null;
}
export function Brand({ linked = true }: { linked?: boolean }) {
  const content = (
    <>
      <svg viewBox="0 0 32 34" aria-hidden="true">
        <path d="M8 6v22L28 17z" fill="currentColor" />
        <path d="M2 8v18" stroke="currentColor" strokeWidth="3" />
      </svg>
      <span>
        Replay<span className="brand-light">Haven</span>
      </span>
    </>
  );
  return linked ? (
    <Link className="brand" to="/" aria-label="ReplayHaven Startseite">
      {content}
    </Link>
  ) : (
    <span className="brand">{content}</span>
  );
}
function ProfileMenu({ mobile = false }: { mobile?: boolean }) {
  const { state } = useVault();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className={mobile ? 'mobile-more' : 'profile-button'} aria-label="Profilmenü">
        {mobile ? (
          <>
            <MenuIcon size={21} />
            <span>Mehr</span>
          </>
        ) : (
          <>
            <span className="avatar">{state.preferences.name.slice(0, 1).toUpperCase()}</span>
            <ChevronDown size={13} />
          </>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown profile-dropdown" sideOffset={12} align="end">
          <Menu.Label>
            {state.preferences.name}
            <small>Dein persönliches Archiv</small>
          </Menu.Label>
          <Menu.Separator />
          <Menu.Item asChild>
            <Link to="/devices">
              <Monitor size={17} />
              Geräte
            </Link>
          </Menu.Item>
          <Menu.Item asChild>
            <Link to="/settings">
              <Settings size={17} />
              Einstellungen
            </Link>
          </Menu.Item>
          <Menu.Item asChild>
            <Link to="/setup">
              <BookOpen size={17} />
              Setup-Guide
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function Layout() {
  const action = useActions();
  const { state, jobs, storageError, server } = useVault();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);
  const nav = [
    { to: '/', name: 'Start', icon: Home },
    { to: '/library', name: 'Bibliothek', icon: Grid2X2 },
    { to: '/collections', name: 'Sammlungen', icon: Folder },
  ];
  return (
    <>
      <RouteScroll />
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>
      <header className={`header ${scrolled || location.pathname !== '/' ? 'solid' : ''}`}>
        <div className="header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label="Hauptnavigation">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'}>
                {n.name}
              </NavLink>
            ))}
          </nav>
          <div className="header-right">
            <button
              className="icon-button search-trigger"
              aria-label="Suche öffnen"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search size={21} />
            </button>
            <button
              aria-label="Clip hochladen"
              className="button upload-button"
              onClick={() => action({ kind: 'upload' })}
            >
              <Upload size={17} />
              <span>Clip hochladen</span>
              {jobs.some((j) => j.status === 'reading') && <span className="upload-dot" />}
            </button>
            <Link
              to="/devices"
              className="connection"
              title={server.connected ? 'Archiv-Server verbunden' : 'Kein Server verbunden'}
            >
              <span />
              {server.connected ? 'Verbunden' : 'Lokal'}
            </Link>
            <span className="header-divider" />
            <ProfileMenu />
          </div>
        </div>
        {searchOpen && (
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/library?q=${encodeURIComponent(query)}`);
              setSearchOpen(false);
            }}
          >
            <Search size={20} />
            <input
              autoFocus
              aria-label="Alle Clips durchsuchen"
              placeholder="Clips, Spiele oder Tags suchen …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchOpen(false);
              }}
            />
            <button className="button primary" type="submit">
              Suchen
            </button>
          </form>
        )}
      </header>
      {storageError && (
        <div className="storage-warning" role="alert">
          Dein Browser kann Änderungen gerade nicht dauerhaft speichern. Prüfe den verfügbaren
          Browserspeicher.
        </div>
      )}
      <main id="main">
        <Outlet />
      </main>
      <footer className="footer">
        <Brand />
        <span>Deine Momente. Dein Archiv.</span>
        <div>
          {state.clips.some((c) => !c.server && !c.local) && (
            <span className="demo-label">Beispiel-Cards</span>
          )}
          <Link to="/devices">
            <WifiOff size={13} />{' '}
            {server.connected ? 'Archiv-Server verbunden' : 'Server nicht verbunden'}{' '}
            <ArrowUpRight size={13} />
          </Link>
        </div>
        <small>{state.clips.length} Clips in deinem Vault</small>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile Navigation">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <n.icon size={21} />
            <span>{n.name}</span>
          </NavLink>
        ))}
        <ProfileMenu mobile />
      </nav>
    </>
  );
}
