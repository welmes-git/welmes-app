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
  fetchedAt: number;             // when we retrieved them
  source: 'server' | 'upstream'; // only successful retrievals are cached
  asOf: number;                  // when the rates themselves were produced
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

/** Where a set of rates came from, so the UI can be honest about staleness. */
export type RateSource = 'server' | 'upstream' | 'cache' | 'fallback';

export interface RateResult {
  rates: Record<string, number>;
  source: RateSource;
  /** When the rates were produced; null when we are on the hardcoded table. */
  asOf: Date | null;
}

/**
 * Rates for DISPLAY. Settlement no longer uses these at all — `place_order`
 * reads `fx_rates` itself and every order is charged in JPY.
 *
 * Order of preference:
 *   1. /api/fx      — the same `fx_rates` rows the server prices from, so a
 *                     displayed price matches what the database would charge.
 *   2. frankfurter  — direct, for local `vite dev` where /api/* is not served.
 *   3. cache        — whatever we last had this session.
 *   4. FALLBACK     — last resort, and reported as such.
 *
 * The fallback table drifts: measured against live ECB rates it was 5% off for
 * USD and 17% off for AUD. It used to be substituted silently, so an outage
 * showed a confidently wrong price. `source` now says which rates you are looking
 * at.
 */
export async function fetchRates(): Promise<RateResult> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rates: cache.rates, source: cache.source, asOf: new Date(cache.asOf) };
  }

  // 1. Server table — authoritative, and shared with order pricing.
  try {
    const res = await fetch('/api/fx');
    if (res.ok) {
      const data = await res.json();
      if (data?.rates && typeof data.rates === 'object' && Number(data.rates.JPY) === 1) {
        const asOf = data.asOf ? new Date(data.asOf).getTime() : Date.now();
        cache = { rates: data.rates, fetchedAt: Date.now(), source: 'server', asOf };
        return { rates: data.rates, source: 'server', asOf: new Date(asOf) };
      }
    }
  } catch { /* fall through */ }

  // 2. Upstream directly. Reachable in dev, where /api/* is not served.
  try {
    // frankfurter.app: free, no API key, ECB-based, CORS-allowed
    // Base=JPY gives us all rates relative to 1 JPY
    const res = await fetch('https://api.frankfurter.app/latest?from=JPY');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const rates: Record<string, number> = { JPY: 1, ...data.rates };
    const now = Date.now();
    cache = { rates, fetchedAt: now, source: 'upstream', asOf: now };
    return { rates, source: 'upstream', asOf: new Date(now) };
  } catch { /* fall through */ }

  // 3/4. Whatever we still hold, and only then the hardcoded table.
  if (cache) return { rates: cache.rates, source: 'cache', asOf: new Date(cache.asOf) };
  return { rates: FALLBACK_RATES, source: 'fallback', asOf: null };
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
