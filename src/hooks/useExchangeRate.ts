import { useState, useEffect } from 'react';
import { fetchRates } from '../lib/currency';

const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour

export function useExchangeRate() {
  const [rates, setRates] = useState<Record<string, number>>({ JPY: 1 });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const r = await fetchRates();
      if (mounted) {
        setRates(r);
        setLoading(false);
        setLastUpdated(new Date());
      }
    };

    load();
    const interval = setInterval(load, REFRESH_INTERVAL);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return { rates, loading, lastUpdated };
}
