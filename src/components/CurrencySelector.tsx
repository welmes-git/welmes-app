import { useState, useRef, useEffect } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { CURRENCIES } from '../lib/currency';
import type { CurrencyCode } from '../lib/currency';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';

export default function CurrencySelector({ large = false }: { large?: boolean }) {
  const { selectedCurrency, setSelectedCurrency } = useStore();
  const { loading, lastUpdated, ratesUnavailable } = useCurrency();
  const { t } = useTranslation();
  /* Three distinct states, previously collapsed into two: rates as of a known
     time, still loading, and unavailable. The last one used to render as
     "loading" forever while prices were quietly drawn from a hardcoded table
     that drifts 5-17% from live rates. */
  const rateLabel = lastUpdated
    ? t('currency.ratesAsOf', { time: lastUpdated.toLocaleTimeString() })
    : ratesUnavailable
      ? t('currency.ratesUnavailable')
      : t('currency.loadingRates');
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
        className={`flex items-center transition-colors hover:text-ink-900 ${large ? 'gap-2 text-[14px] leading-5 text-ink-700' : 'gap-1.5 text-[12px] text-ink-500'}`}
        title={rateLabel}
      >
        <span>{current.flag}</span>
        <span className={large ? '' : 'font-semibold'}>{current.code}</span>
        {loading && <RefreshCw size={10} className="animate-spin text-ink-300" />}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[200px] bg-canvas border border-line rounded-lg shadow-hover z-50 py-1 overflow-hidden">
          <p className={`text-[10px] tabular-nums px-3 py-1.5 border-b border-line ${
            ratesUnavailable ? 'text-signal-error' : 'text-ink-500'
          }`}>
            {rateLabel}
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
