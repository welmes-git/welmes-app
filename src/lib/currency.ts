export type CurrencyCode = 'JPY' | 'USD' | 'EUR' | 'GBP' | 'CNY' | 'KRW' | 'SGD' | 'AUD';

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: number;
  flag: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'JPY', name: 'Japanese Yen',        symbol: '¥',  decimals: 0, flag: '🇯🇵' },
  { code: 'USD', name: 'US Dollar',            symbol: '$',  decimals: 2, flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro',                 symbol: '€',  decimals: 2, flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound',        symbol: '£',  decimals: 2, flag: '🇬🇧' },
  { code: 'CNY', name: 'Chinese Yuan',         symbol: '¥',  decimals: 0, flag: '🇨🇳' },
  { code: 'KRW', name: 'Korean Won',           symbol: '₩',  decimals: 0, flag: '🇰🇷' },
  { code: 'SGD', name: 'Singapore Dollar',     symbol: 'S$', decimals: 2, flag: '🇸🇬' },
  { code: 'AUD', name: 'Australian Dollar',    symbol: 'A$', decimals: 2, flag: '🇦🇺' },
];

export const getCurrencyInfo = (code: CurrencyCode): CurrencyInfo =>
  CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];

// ── Rate cache ──────────────────────────────────────────────────────────────
interface RateCache {
  rates: Record<string, number>; // rates relative to JPY base
  fetchedAt: number;
}

let cache: RateCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Fallback rates (JPY base) in case API is unavailable
const FALLBACK_RATES: Record<string, number> = {
  JPY: 1,
  USD: 0.0067,
  EUR: 0.0062,
  GBP: 0.0053,
  CNY: 0.049,
  KRW: 9.05,
  SGD: 0.0091,
  AUD: 0.0104,
};

export async function fetchRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates;
  }

  try {
    // frankfurter.app: free, no API key, ECB-based, CORS-allowed
    // Base=JPY gives us all rates relative to 1 JPY
    const res = await fetch('https://api.frankfurter.app/latest?from=JPY');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const rates: Record<string, number> = { JPY: 1, ...data.rates };
    cache = { rates, fetchedAt: Date.now() };
    return rates;
  } catch {
    // Return cached or fallback
    return cache?.rates ?? FALLBACK_RATES;
  }
}

export function convert(amountJPY: number, to: CurrencyCode, rates: Record<string, number>): number {
  const rate = rates[to] ?? FALLBACK_RATES[to] ?? 1;
  return amountJPY * rate;
}

export function formatPrice(amountJPY: number, currency: CurrencyCode, rates: Record<string, number>): string {
  const info = getCurrencyInfo(currency);
  const converted = convert(amountJPY, currency, rates);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: info.decimals,
    maximumFractionDigits: info.decimals,
  }).format(converted);
  return `${info.symbol}${formatted}`;
}
