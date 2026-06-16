import { useState, useRef, useEffect } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { CURRENCIES } from '../lib/currency';
import type { CurrencyCode } from '../lib/currency';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';

export default function CurrencySelector() {
  const { selectedCurrency, setSelectedCurrency } = useStore();
  const { loading, lastUpdated } = useCurrency();
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
        className="flex items-center gap-1.5 text-[12px] text-[#555] hover:text-[#222] transition-colors"
        title={lastUpdated ? `Rates updated: ${lastUpdated.toLocaleTimeString()}` : 'Loading rates…'}
      >
        <span>{current.flag}</span>
        <span className="font-semibold">{current.code}</span>
        {loading && <RefreshCw size={10} className="animate-spin text-[#aaa]" />}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[200px] bg-white border border-[#e5e5e5] rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          <p className="text-[10px] text-[#aaa] px-3 py-1.5 border-b border-[#f0f0f0]">
            {lastUpdated
              ? `Rates as of ${lastUpdated.toLocaleTimeString()}`
              : 'Loading exchange rates…'}
          </p>
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              onClick={() => { setSelectedCurrency(c.code as CurrencyCode); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] hover:bg-[#f8f8fa] transition-colors ${
                c.code === selectedCurrency ? 'bg-[#f0f7ff] text-[#4a90e2] font-semibold' : 'text-[#444]'
              }`}
            >
              <span className="text-[16px]">{c.flag}</span>
              <span className="font-mono font-bold w-8">{c.code}</span>
              <span className="text-[#888]">{c.name}</span>
              <span className="ml-auto font-bold">{c.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
