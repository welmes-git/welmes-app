// WELMES — FX rate endpoint.
//
// `place_order` reads the charge rate from `fx_rates` and refuses a
// foreign-currency order once the stored rate passes its hard age limit, so
// something has to keep that table current. This endpoint is that something: it
// returns the stored rates and refreshes them from the ECB feed when they are
// stale.
//
// It is deliberately a plain GET with no auth. The rates are already visible in
// every price on the storefront, and making it public means the storefront itself
// keeps the table warm — there is no cron to forget and no window where a stale
// table silently blocks checkout.
//
// Writes go through `upsert_fx_rates`, which is granted to the service role only
// and which never overwrites a rate an admin pinned with source='manual'.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';
import { syncFxRates } from '../server/payments.mjs';

const env = (...keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
};

type RateRow = { currency: string; rate_jpy: number | string; source: string; fetched_at: string };

function admin() {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SERVICE_ROLE_NOT_CONFIGURED');
  return createClient(env('SUPABASE_URL', 'VITE_SUPABASE_URL'), key, { auth: { persistSession: false } });
}

/**
 * Minimal shape `syncFxRates` needs. Declared structurally because the Supabase
 * client's generics do not survive being passed through a plain adapter.
 */
type FxStore = {
  from: (table: string) => { select: (columns: string) => Promise<{ data: unknown; error: { message: string } | null }> };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
};

/** Adapter so server/payments.mjs stays free of Supabase specifics. */
function rpcAdapter(client: FxStore) {
  return {
    async readRates() {
      const { data, error } = await client.from('fx_rates').select('currency, rate_jpy, source, fetched_at');
      return { rows: (data ?? []) as RateRow[], error: error?.message };
    },
    async writeRates(rates: Record<string, number>) {
      const { error } = await client.rpc('upsert_fx_rates', { p_rates: rates, p_source: 'frankfurter' });
      return { error: error?.message };
    },
  };
}

function json(body: unknown, status = 200, cache = 'public, max-age=300'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  });
}

async function handle(): Promise<Response> {
  let client;
  try {
    client = admin();
  } catch (error) {
    return json({ code: 'SERVER_ERROR', detail: (error as Error).message }, 503, 'no-store');
  }

  const adapter = rpcAdapter(client as unknown as FxStore);
  const sync = await syncFxRates(adapter);
  const { rows, error } = await adapter.readRates();
  if (error) return json({ code: 'FX_UNAVAILABLE', detail: error }, 503, 'no-store');

  const rates: Record<string, number> = {};
  let oldest: string | null = null;
  for (const row of rows) {
    rates[row.currency] = Number(row.rate_jpy);
    if (!oldest || row.fetched_at < oldest) oldest = row.fetched_at;
  }

  return json({
    rates,
    // Surfaced so the storefront can show "rates as of ..." instead of implying
    // that whatever it holds is current.
    asOf: oldest,
    refreshed: sync.refreshed,
    note: sync.reason,
  });
}

// Node-style (req, res) and Web-style (Request) invocations are both supported,
// for the same reason api/ssr.ts does it: Vercel may use either.
type NodeRes = { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void };

export default async function handler(_a: unknown, b?: NodeRes): Promise<Response | void> {
  if (b && typeof b.end === 'function') {
    const response = await handle();
    b.statusCode = response.status;
    response.headers.forEach((value, key) => b.setHeader(key, value));
    b.end(await response.text());
    return;
  }
  return handle();
}
