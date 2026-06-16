import { createContext, useContext, ReactNode } from 'react';
import { useExchangeRate } from '../hooks/useExchangeRate';
import { formatPrice as _formatPrice, getCurrencyInfo } from '../lib/currency';
import type { CurrencyCode } from '../lib/currency';
import { useStore } from '../store/useStore';

interface CurrencyContextValue {
  currency: CurrencyCode;
  rates: Record<string, number>;
  loading: boolean;
  lastUpdated: Date | null;
  formatPrice: (amountJPY: number) => string;
  currencyInfo: ReturnType<typeof getCurrencyInfo>;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { selectedCurrency } = useStore();
  const { rates, loading, lastUpdated } = useExchangeRate();

  const value: CurrencyContextValue = {
    currency: selectedCurrency,
    rates,
    loading,
    lastUpdated,
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
