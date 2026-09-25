import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { ActionProvider } from './components/Actions';
import { Layout } from './components/Layout';
import { EmptyState } from './components/Cards';
import { StreamingHomeContainer } from './streaming';
import { t } from './i18n';
const Library = lazy(() => import('./streaming/LibraryPage'));
const Collections = lazy(() =>
  import('./streaming/CollectionsPage').then((m) => ({ default: m.StreamingCollectionsPage })),
);
const CollectionDetail = lazy(() =>
  import('./streaming/CollectionsPage').then((m) => ({ default: m.StreamingCollectionDetailPage })),
);
const SmartCollection = lazy(() =>
  import('./streaming/CollectionsPage').then((m) => ({ default: m.StreamingSmartCollectionPage })),
);
const ClipDetail = lazy(() => import('./pages/ClipDetail'));
const SharePage = lazy(() => import('./pages/ClipDetail').then((m) => ({ default: m.SharePage })));
const Devices = lazy(() => import('./pages/Devices'));
const Settings = lazy(() => import('./pages/Settings'));
const Setup = lazy(() => import('./pages/Setup'));
const Users = lazy(() => import('./pages/Users'));
export function App() {
  return (
    <ActionProvider>
      <Suspense
        fallback={
          <div className="page loading-page" aria-label={t('common.loading')}>
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
            <Route path="collections/auto/:id" element={<SmartCollection />} />
            <Route path="devices" element={<Devices />} />
            <Route path="settings" element={<Settings />} />
            <Route path="setup" element={<Setup />} />
            <Route path="users" element={<Users />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <EmptyState title={t('notFound.title')} description={t('notFound.text')}>
                    <Link className="button primary" to="/">
                      {t('notFound.home')}
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
