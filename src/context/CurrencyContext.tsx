import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useExchangeRate } from '../hooks/useExchangeRate';
import { formatPrice as _formatPrice, getCurrencyInfo } from '../lib/currency';
import type { CurrencyCode, RateSource } from '../lib/currency';
import { useStore } from '../store/useStore';

interface CurrencyContextValue {
  currency: CurrencyCode;
  rates: Record<string, number>;
  loading: boolean;
  /** When the rates were produced; null when the hardcoded table is in use. */
  lastUpdated: Date | null;
  source: RateSource;
  /** True while displayed prices come from the drifting hardcoded table. */
  ratesUnavailable: boolean;
  formatPrice: (amountJPY: number) => string;
  currencyInfo: ReturnType<typeof getCurrencyInfo>;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { selectedCurrency } = useStore();
  const { rates, loading, lastUpdated, source, ratesUnavailable } = useExchangeRate();

  const value: CurrencyContextValue = {
    currency: selectedCurrency,
    rates,
    loading,
    lastUpdated,
    source,
    ratesUnavailable,
    formatPrice: (amountJPY) => _formatPrice(amountJPY, selectedCurrency, rates),
    currencyInfo: getCurrencyInfo(selectedCurrency),
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
