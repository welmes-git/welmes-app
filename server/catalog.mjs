// Columns fetched for server rendering. Deliberately excludes prices, set
// pricing and supplier metadata — those must never reach an unauthenticated
// page. name_i18n/description_i18n ARE included: without them the server HTML
// (and the bootstrap the client hydrates from) falls back to raw Japanese, which
// is what search engines would index.
const PUBLIC_COLUMNS = [
  'id','name','name_en','name_i18n','brand','category','subcategory','image','images','discount',
  'tags','rating','reviews','description','description_i18n','stock','status','created_at','updated_at',
  'seo_slug','seo_title','seo_description','search_aliases','name_en_status','jan',
].join(',');

function serverConfig(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for SSR');
  return { url: url.replace(/\/$/, ''), key };
}

async function queryPublic(search, { env = process.env, fetchImpl = fetch } = {}) {
  const { url, key } = serverConfig(env);
  const response = await fetchImpl(`${url}/rest/v1/products_public?${search}`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`public catalogue HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

export function publicRowToProduct(row) {
  return {
    id: Number(row.id),
    name: row.name || '',
    nameEn: row.name_en || row.name || '',
    nameI18n: row.name_i18n || undefined,
    nameEnStatus: row.name_en_status || undefined,
    seoSlug: row.seo_slug || undefined,
    seoTitle: row.seo_title || undefined,
    seoDescription: row.seo_description || undefined,
    searchAliases: row.search_aliases || [],
    jan: row.jan || undefined,
    updatedAt: row.updated_at || row.created_at || undefined,
    brand: row.brand || '',
    category: row.category || '',
    subcategory: row.subcategory || undefined,
    image: row.image || '',
    images: row.images || [],
    originalPrice: 0,
    wholesalePrice: 0,
    discount: Number(row.discount || 0),
    tags: row.tags || [],
    rating: Number(row.rating || 0),
    reviews: Number(row.reviews || 0),
    description: row.description || '',
    descriptionI18n: row.description_i18n || undefined,
    stock: Number(row.stock || 0),
    status: row.status || 'inactive',
    setOptions: [],
  };
}

export async function loadPublicProduct(id, options = {}) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
  const params = new URLSearchParams({ select: PUBLIC_COLUMNS, id: `eq.${Number(id)}`, limit: '1' });
  const rows = await queryPublic(params.toString(), options);
  return rows[0] ? publicRowToProduct(rows[0]) : null;
}

export async function listIndexableProducts(options = {}) {
  const all = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      select: 'id,name,name_en,seo_slug,name_en_status,status,updated_at,created_at',
      status: 'eq.active',
      name_en_status: 'in.(auto_approved,human_approved)',
      seo_slug: 'not.is.null',
      order: 'id.asc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const rows = await queryPublic(params.toString(), options);
    all.push(...rows.map(publicRowToProduct));
    if (rows.length < pageSize) return all;
  }
}
