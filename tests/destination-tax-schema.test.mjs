// Guards 20260930_destination_tax.sql and src/config/countries.ts.
//
// The selling entity is Japanese, so a flat 10% worldwide was wrong twice over:
// export sales are zero-rated (輸出免税), and the input tax paid to suppliers is
// recoverable, so the 10% collected from overseas buyers covered nothing. It also
// read as double taxation to a buyer who then pays import VAT at their own border.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260930_destination_tax.sql', import.meta.url), 'utf8');
const countries = fs.readFileSync(new URL('../src/config/countries.ts', import.meta.url), 'utf8');
const price = sql.match(/create or replace function public\._price_order[\s\S]*?\n\$\$;/)?.[0] || '';
const placeOrder = sql.match(/create or replace function public\.place_order[\s\S]*?\n\$\$;/)?.[0] || '';

test('tax rules seed domestic 10% and export 0%', () => {
  assert.match(sql, /create table if not exists public\.tax_rules/);
  assert.match(sql, /\('JP',\s*'domestic_vat',\s*0\.10/);
  assert.match(sql, /\(null,\s*'export_exempt',\s*0\.00/);
  // The catch-all must lose to a country-specific rule
  assert.match(sql, /order by \(ship_to is null\), priority, id/);
});

test('rules are readable but only admins may change them', () => {
  assert.match(sql, /create policy "tax_rules_select" on public\.tax_rules for select using \(true\)/);
  assert.match(sql, /revoke insert, update, delete on public\.tax_rules from anon, authenticated/);
});

test('a missing rule charges nothing rather than guessing', () => {
  // Over-charging tax on an export is the failure we are removing; defaulting to
  // 10% on a config gap would reintroduce it.
  assert.match(price, /if v_rule\.id is null then\s*\n\s*--[\s\S]*?v_tax := 0;/);
  assert.match(price, /v_rule\.mode := 'none'/);
});

test('pricing is one implementation shared by quote and order', () => {
  assert.ok(price, '_price_order must exist');
  assert.match(sql, /create or replace function public\.quote_order/);
  assert.match(sql, /select public\._price_order\(p_items, p_shipping\)/);
  assert.match(placeOrder, /v_price := public\._price_order\(p_items, p_shipping\)/);
  // No second copy of the tax arithmetic in place_order
  assert.doesNotMatch(placeOrder, /c_vat_rate/);
  assert.doesNotMatch(placeOrder, /round\(v_subtotal \*/);
});

test('quote_order writes nothing and is not reachable by anon', () => {
  assert.match(sql, /create or replace function public\.quote_order[\s\S]*?\n\s*stable/);
  assert.doesNotMatch(sql.match(/create or replace function public\._price_order[\s\S]*?\n\$\$;/)[0],
    /insert into|update public\.(orders|products)|delete from/);
  assert.match(sql, /revoke all on function public\.quote_order\(jsonb, jsonb\) from public, anon/);
  assert.match(sql, /grant execute on function public\.quote_order\(jsonb, jsonb\) to authenticated/);
  assert.match(sql, /revoke all on function public\._price_order\(jsonb, jsonb\) from public, anon, authenticated/);
});

test('the destination is matched on an ISO code, not a display name', () => {
  assert.match(sql, /add column if not exists ship_to_country text/);
  assert.match(price, /p_shipping->>'countryCode'/);
  assert.match(placeOrder, /coalesce\(nullif\(p_shipping->>'countryCode',''\), p_shipping->>'country', ''\) = ''/);
  assert.match(sql, /create index if not exists orders_ship_to_country_idx/);
});

test('tax and incoterms are recorded on every order', () => {
  for (const col of ['tax_rate', 'tax_mode', 'tax_note_key', 'shipping_fee', 'incoterms']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}`), `${col} missing`);
  }
  assert.match(sql, /check \(tax_mode is null or tax_mode in \('domestic_vat','export_exempt','none'\)\)/);
  assert.match(sql, /check \(incoterms is null or incoterms in \('EXW','FOB','CIF','DAP','DDP'\)\)/);
  assert.match(price, /'incoterms',\s*'DAP'/);
});

test('freight is left at zero rather than guessed', () => {
  // A made-up rate either loses money or drives buyers away; orders record 0 and
  // freight is invoiced separately until real carrier rates exist.
  assert.match(price, /v_shipping := 0;/);
  assert.match(sql, /add column if not exists shipping_fee  integer not null default 0/);
});

test('stock is still taken after pricing, inside place_order only', () => {
  const fxAt = placeOrder.indexOf('_price_order');
  const stockAt = placeOrder.indexOf('set stock = stock -');
  assert.ok(fxAt > 0 && stockAt > fxAt, 'pricing must precede the stock decrement');
  assert.match(placeOrder, /for update/);
  assert.match(placeOrder, /INSUFFICIENT_STOCK/);
});

test('historical orders keep the tax they were actually charged', () => {
  // Rewriting them to 0% would desync the books from what buyers paid.
  assert.match(sql, /update public\.orders set\s*\n\s*tax_rate = case when total > 0 and vat > 0/);
  assert.match(sql, /tax_mode = case when vat > 0 then 'domestic_vat' else 'none' end/);
  assert.match(sql, /where o\.ship_to_country is null/);
});

test('country catalogue is keyed by ISO code with Japan as home', () => {
  assert.match(countries, /export const HOME_COUNTRY = 'JP'/);
  assert.match(countries, /\{ code: 'JP', name: 'Japan',\s*zone: 'domestic' \}/);
  // 'Other' produced addresses with no resolvable destination. Strip comments so
  // the prose explaining that does not trip the check.
  const code = countries.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /'Other'/);
  for (const c of ['KR', 'US', 'GB', 'DE', 'AU', 'SG', 'FR', 'CA']) {
    assert.match(code, new RegExp(`code: '${c}'`), `${c} missing`);
  }
});

test('isExport treats anything outside the home country as an export', () => {
  assert.match(countries, /export const isExport[\s\S]*?!== HOME_COUNTRY/);
  assert.match(countries, /export const codeFromLegacyName/);
});
