// WELMES — shipping destinations, keyed by ISO 3166-1 alpha-2.
//
// The checkout used to offer eighteen hardcoded display names plus 'Other', and
// stored the display string ("South Korea") on the order. Two problems: a buyer
// who picked 'Other' produced an address with no resolvable country, and a tax
// rule or shipping zone cannot be looked up from a free-text label.
//
// `code` is what gets stored and matched on. `name` is presentation only.

export interface Country {
  code: string;
  name: string;
  /** Coarse shipping zone — the unit carriers quote by. */
  zone: 'domestic' | 'asia' | 'oceania' | 'north_america' | 'europe' | 'rest';
}

/** Where the selling entity is established; drives domestic vs export tax. */
export const HOME_COUNTRY = 'JP';

export const COUNTRIES: Country[] = [
  { code: 'JP', name: 'Japan',                zone: 'domestic' },
  // ── Asia ──
  { code: 'KR', name: 'South Korea',          zone: 'asia' },
  { code: 'CN', name: 'China',                zone: 'asia' },
  { code: 'HK', name: 'Hong Kong',            zone: 'asia' },
  { code: 'TW', name: 'Taiwan',               zone: 'asia' },
  { code: 'SG', name: 'Singapore',            zone: 'asia' },
  { code: 'MY', name: 'Malaysia',             zone: 'asia' },
  { code: 'TH', name: 'Thailand',             zone: 'asia' },
  { code: 'VN', name: 'Vietnam',              zone: 'asia' },
  { code: 'PH', name: 'Philippines',          zone: 'asia' },
  { code: 'ID', name: 'Indonesia',            zone: 'asia' },
  { code: 'IN', name: 'India',                zone: 'asia' },
  { code: 'MO', name: 'Macau',                zone: 'asia' },
  { code: 'KH', name: 'Cambodia',             zone: 'asia' },
  { code: 'LA', name: 'Laos',                 zone: 'asia' },
  { code: 'MM', name: 'Myanmar',              zone: 'asia' },
  { code: 'BN', name: 'Brunei',               zone: 'asia' },
  { code: 'MN', name: 'Mongolia',             zone: 'asia' },
  { code: 'AE', name: 'United Arab Emirates', zone: 'asia' },
  { code: 'SA', name: 'Saudi Arabia',         zone: 'asia' },
  { code: 'IL', name: 'Israel',               zone: 'asia' },
  { code: 'TR', name: 'Türkiye',              zone: 'asia' },
  // ── Oceania ──
  { code: 'AU', name: 'Australia',            zone: 'oceania' },
  { code: 'NZ', name: 'New Zealand',          zone: 'oceania' },
  { code: 'GU', name: 'Guam',                 zone: 'oceania' },
  // ── North America ──
  { code: 'US', name: 'United States',        zone: 'north_america' },
  { code: 'CA', name: 'Canada',               zone: 'north_america' },
  { code: 'MX', name: 'Mexico',               zone: 'north_america' },
  // ── Europe ──
  { code: 'GB', name: 'United Kingdom',       zone: 'europe' },
  { code: 'DE', name: 'Germany',              zone: 'europe' },
  { code: 'FR', name: 'France',               zone: 'europe' },
  { code: 'IT', name: 'Italy',                zone: 'europe' },
  { code: 'ES', name: 'Spain',                zone: 'europe' },
  { code: 'NL', name: 'Netherlands',          zone: 'europe' },
  { code: 'BE', name: 'Belgium',              zone: 'europe' },
  { code: 'AT', name: 'Austria',              zone: 'europe' },
  { code: 'CH', name: 'Switzerland',          zone: 'europe' },
  { code: 'SE', name: 'Sweden',               zone: 'europe' },
  { code: 'NO', name: 'Norway',               zone: 'europe' },
  { code: 'DK', name: 'Denmark',              zone: 'europe' },
  { code: 'FI', name: 'Finland',              zone: 'europe' },
  { code: 'IE', name: 'Ireland',              zone: 'europe' },
  { code: 'PL', name: 'Poland',               zone: 'europe' },
  { code: 'PT', name: 'Portugal',             zone: 'europe' },
  { code: 'CZ', name: 'Czechia',              zone: 'europe' },
  { code: 'GR', name: 'Greece',               zone: 'europe' },
  { code: 'HU', name: 'Hungary',              zone: 'europe' },
  { code: 'RO', name: 'Romania',              zone: 'europe' },
  { code: 'RU', name: 'Russia',               zone: 'europe' },
  // ── Rest ──
  { code: 'BR', name: 'Brazil',               zone: 'rest' },
  { code: 'CL', name: 'Chile',                zone: 'rest' },
  { code: 'AR', name: 'Argentina',            zone: 'rest' },
  { code: 'ZA', name: 'South Africa',         zone: 'rest' },
  { code: 'EG', name: 'Egypt',                zone: 'rest' },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

export const findCountry = (code?: string | null): Country | undefined =>
  code ? BY_CODE.get(code.trim().toUpperCase()) : undefined;

export const countryName = (code?: string | null): string =>
  findCountry(code)?.name ?? (code ?? '');

/**
 * Resolve a code from an order written before codes existed, where `country`
 * holds a display name. Falls back to undefined rather than guessing, so a tax
 * rule never matches on a bad inference.
 */
export const codeFromLegacyName = (name?: string | null): string | undefined =>
  name ? BY_NAME.get(name.trim().toLowerCase())?.code : undefined;

/** True when the destination is an export (zero-rated for a Japanese seller). */
export const isExport = (code?: string | null): boolean =>
  (findCountry(code)?.code ?? '') !== HOME_COUNTRY;
