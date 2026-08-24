import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.jsx';
import { LanguageProvider } from './i18n/LanguageProvider.jsx';
// Orden deliberado: primero los tokens del design system (define --color-*,
// --space-*, .btn, .card, .tag), luego el CSS de pantallas que los consume,
// y al final los ajustes de shell nativo.
import './ds/styles.css';
import './styles/screens.css';
import './styles/app.css';

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>
);
