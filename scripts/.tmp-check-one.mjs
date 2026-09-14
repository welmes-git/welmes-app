import { loadEnvFiles, createSupabase } from './lib/sd-core.mjs';
loadEnvFiles();
console.log('1) 모듈/env 로드 완료');
const { createClient } = await import('@supabase/supabase-js');
const supabase = createSupabase(createClient);
const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.WELMES_ADMIN_EMAIL, password: process.env.WELMES_ADMIN_PASSWORD });
if (authErr) { console.log('❌ WELMES 로그인 실패:', authErr.message); process.exit(1); }
const { data } = await supabase.from('products').select('id, name, status, stock, sd_product_id').eq('id', 76).single();
console.log('2) DB 상품:', JSON.stringify(data));
const { data: ch } = await supabase.from('sd_product_changes').select('change_type, new_value').eq('product_id', 76).order('created_at', { ascending: false }).limit(1).maybeSingle();
console.log('3) 변동 로그:', JSON.stringify(ch));
const { chromium } = await import('playwright');
const ctx = await chromium.launch({ headless: true }).then(b => b.newContext({ storageState: 'scripts/.sd-session.json' }));
const page = await ctx.newPage();
console.log('4) 페이지 접속 중...');
await page.goto(`https://www.superdelivery.com/p/r/pd_p/${data.sd_product_id}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.innerText?.slice(0, 50) ?? '(없음)',
  notTrading: !!document.querySelector('.product-information-box.not-trading'),
  setRows: document.querySelectorAll('table.set-list tr').length,
  setHead: document.querySelector('table.set-list')?.innerText?.replace(/\n/g, ' | ').slice(0, 150) ?? '(세트표 없음)',
}));
console.log('5) 페이지 상태:', JSON.stringify(info, null, 2));
await ctx.close();
