import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles.css';
import './analysis.css';
import './streaming/streaming.css';
import { VaultProvider } from './data/store';
import { App } from './App';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <VaultProvider>
        <App />
      </VaultProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
