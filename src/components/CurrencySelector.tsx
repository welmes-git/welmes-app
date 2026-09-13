import { useState, useRef, useEffect } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { CURRENCIES } from '../lib/currency';
import type { CurrencyCode } from '../lib/currency';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';

export default function CurrencySelector() {
  const { selectedCurrency, setSelectedCurrency } = useStore();
  const { loading, lastUpdated } = useCurrency();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = CURRENCIES.find((c) => c.code === selectedCurrency)!;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-900 transition-colors"
        title={lastUpdated ? t('currency.ratesAsOf', { time: lastUpdated.toLocaleTimeString() }) : t('currency.loadingRates')}
      >
        <span>{current.flag}</span>
        <span className="font-semibold">{current.code}</span>
        {loading && <RefreshCw size={10} className="animate-spin text-ink-300" />}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[200px] bg-canvas border border-line rounded-lg shadow-hover z-50 py-1 overflow-hidden">
          <p className="text-[10px] tabular-nums text-ink-500 px-3 py-1.5 border-b border-line">
            {lastUpdated
              ? t('currency.ratesAsOf', { time: lastUpdated.toLocaleTimeString() })
              : t('currency.loadingRates')}
          </p>
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              onClick={() => { setSelectedCurrency(c.code as CurrencyCode); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] hover:bg-sunken transition-colors ${
                c.code === selectedCurrency ? 'bg-sunken text-ink-900 font-bold shadow-[inset_2px_0_0_var(--wm-ink-900)]' : 'text-ink-700'
              }`}
            >
              <span className="text-[16px]">{c.flag}</span>
              <span className="font-mono font-bold w-8">{c.code}</span>
              <span className="text-ink-500">{c.name}</span>
              <span className="ml-auto font-bold">{c.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
