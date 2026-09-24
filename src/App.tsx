import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { ActionProvider } from './components/Actions';
import { Layout } from './components/Layout';
import { EmptyState } from './components/Cards';
import { StreamingHomeContainer } from './streaming';
const Library = lazy(() => import('./streaming/LibraryPage'));
const Collections = lazy(() =>
  import('./streaming/CollectionsPage').then((m) => ({ default: m.StreamingCollectionsPage })),
);
const CollectionDetail = lazy(() =>
  import('./streaming/CollectionsPage').then((m) => ({ default: m.StreamingCollectionDetailPage })),
);
const ClipDetail = lazy(() => import('./pages/ClipDetail'));
const SharePage = lazy(() => import('./pages/ClipDetail').then((m) => ({ default: m.SharePage })));
const Devices = lazy(() => import('./pages/Devices'));
const Settings = lazy(() => import('./pages/Settings'));
export function App() {
  return (
    <ActionProvider>
      <Suspense
        fallback={
          <div className="page loading-page" aria-label="Inhalt wird geladen">
            <div className="skeleton-heading" />
            <div className="skeleton-grid">
              {[1, 2, 3, 4].map((i) => (
                <div className="skeleton-card" key={i} />
              ))}
            </div>
          </div>
        }
      >
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<StreamingHomeContainer />} />
            <Route path="library" element={<Library />} />
            <Route path="clips/:id" element={<ClipDetail />} />
            <Route path="collections" element={<Collections />} />
            <Route path="collections/:id" element={<CollectionDetail />} />
            <Route path="devices" element={<Devices />} />
            <Route path="settings" element={<Settings />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <EmptyState
                    title="Hier ist kein Clip gelandet."
                    description="Diese Seite gibt es nicht. Dein Archiv findest du gleich nebenan."
                  >
                    <Link className="button primary" to="/">
                      Zur Startseite
                    </Link>
                  </EmptyState>
                </div>
              }
            />
          </Route>
          <Route path="share/:token" element={<SharePage />} />
        </Routes>
      </Suspense>
    </ActionProvider>
  );
}
