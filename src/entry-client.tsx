import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { startClientLanguageDetection } from './i18n';
import App from './App';
import { CurrencyProvider } from './context/CurrencyContext';
import { useStore } from './store/useStore';
import type { Product } from './store/useStore';
import { SsrProductContext } from './lib/ssrProductContext';

declare global {
  interface Window { __WELMES_SSR_PRODUCT__?: Product }
}

const legacyHash = window.location.hash;
if (legacyHash.startsWith('#/')) {
  window.history.replaceState(null, '', legacyHash.slice(1));
}

const ssrProduct = window.__WELMES_SSR_PRODUCT__;
if (ssrProduct) {
  useStore.setState({ products: [ssrProduct], productsLoading: false });
}

const tree = (
  <StrictMode>
    <BrowserRouter>
      <SsrProductContext.Provider value={ssrProduct ?? null}>
        <CurrencyProvider>
          <App />
        </CurrencyProvider>
      </SsrProductContext.Provider>
    </BrowserRouter>
  </StrictMode>
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
if (ssrProduct) hydrateRoot(root, tree);
else createRoot(root).render(tree);

// Apply browser-persisted preferences only after the server tree has hydrated.
setTimeout(() => {
  void useStore.persist.rehydrate();
  startClientLanguageDetection();
}, 0);
