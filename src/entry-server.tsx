import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import './i18n';
import App from './App';
import { CurrencyProvider } from './context/CurrencyContext';
import { useStore } from './store/useStore';
import type { Product } from './store/useStore';
import { buildProductSeo, renderProductSeoHead } from './lib/productSeo';
import { productPath } from './lib/productUrl';
import { SsrProductContext } from './lib/ssrProductContext';

export function productSeoForServer(product: Product, origin: string) {
  return buildProductSeo(product, origin);
}

export function productSeoHeadForServer(product: Product, origin: string): string {
  return renderProductSeoHead(buildProductSeo(product, origin));
}

export function productPathForServer(product: Product): string {
  return productPath(product);
}

export function renderProductApp(product: Product, url: string): string {
  const previous = useStore.getState();
  useStore.setState({
    products: [product],
    productsLoading: false,
    currentUser: null,
    isAuthenticated: false,
    isAdmin: false,
    authLoading: false,
    cart: [],
    wishlist: [],
    notifications: [],
    selectedCurrency: 'JPY',
    toast: null,
  });
  try {
    return renderToString(
      <StrictMode>
        <StaticRouter location={url}>
          <SsrProductContext.Provider value={product}>
            <CurrencyProvider>
              <App />
            </CurrencyProvider>
          </SsrProductContext.Provider>
        </StaticRouter>
      </StrictMode>,
    );
  } finally {
    useStore.setState(previous, true);
  }
}
