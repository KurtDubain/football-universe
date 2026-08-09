import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './i18n';
import App from './app/App';
import AppErrorBoundary from './app/AppErrorBoundary';
import GameFeedbackBridge from './feedback/GameFeedbackBridge';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <GameFeedbackBridge />
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD) {
  void import('./pwa/app-update').then(({ startAppUpdateMonitor }) => {
    startAppUpdateMonitor();
  });
}
