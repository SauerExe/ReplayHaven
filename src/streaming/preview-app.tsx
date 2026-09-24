import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import '../styles.css';
import '../analysis.css';
import { ActionProvider } from '../components/Actions';
import { Layout } from '../components/Layout';
import { VaultProvider } from '../data/store';
import { StreamingHomeContainer } from './connected';

/** Die Startseite so, wie sie nach dem Einbau in App.tsx läuft: echter Store, Aktionen, Layout. */
export default function AppPreview() {
  return (
    <BrowserRouter basename="/streaming-preview.html">
      <VaultProvider>
        <ActionProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<StreamingHomeContainer />} />
              <Route
                path="*"
                element={
                  <div className="page">
                    <p>
                      Diese Vorschau enthält nur die Startseite.{' '}
                      <Link to="/?modus=app">Zur Startseite</Link>
                    </p>
                  </div>
                }
              />
            </Route>
          </Routes>
        </ActionProvider>
      </VaultProvider>
    </BrowserRouter>
  );
}
