import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles.css';
import './analysis.css';
import './streaming/streaming.css';
import './subpages.css';
import './interactions.css';
import './auth.css';
import { VaultProvider } from './data/store';
import { AuthGate } from './components/AuthGate';
import { App } from './App';
import { LanguageBoundary } from './i18n';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate>
        <VaultProvider>
          <LanguageBoundary>
            <App />
          </LanguageBoundary>
        </VaultProvider>
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
