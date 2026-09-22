import { useState, useEffect } from 'react';
import { fetchRates } from '../lib/currency';
import type { RateSource } from '../lib/currency';

const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour

export function useExchangeRate() {
  const [rates, setRates] = useState<Record<string, number>>({ JPY: 1 });
  const [loading, setLoading] = useState(true);
  /**
   * When the rates were produced, not when we fetched them. Previously this was
   * set to `new Date()` on every load, so a run that fell back to the hardcoded
   * table still reported itself as up to date.
   */
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [source, setSource] = useState<RateSource>('fallback');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const result = await fetchRates();
      if (mounted) {
        setRates(result.rates);
        setLoading(false);
        setLastUpdated(result.asOf);
        setSource(result.source);
      }
    };

    load();
    const interval = setInterval(load, REFRESH_INTERVAL);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  /** True while prices are drawn from the drifting hardcoded table. */
  const ratesUnavailable = source === 'fallback';

  return { rates, loading, lastUpdated, source, ratesUnavailable };
}
