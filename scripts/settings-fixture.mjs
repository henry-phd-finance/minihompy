import { readFile } from 'node:fs/promises';
// Test data comes from the migration seed; it is never shipped as a UI fallback.
const sql = await readFile(new URL('../supabase/migrations/202609130003_settings.sql', import.meta.url), 'utf8');
export const initialSettings = JSON.parse(sql.split('$config$')[1]);
export const initialProfile = { id: 1, image_path: 'assets/photos/lake.jpg', image_alt: '호수 풍경', image_width: 192, name: null, paragraphs: null, revision: 1 };
export async function mockSettings(page, payload = initialSettings) {
  await page.route('**/rest/v1/minihompy_profile*', route => route.fulfill({ json: [initialProfile] }));
  await page.route('**/rest/v1/minihompy_settings*', route => route.fulfill({
    json: [{ payload, revision: 1 }],
    headers: { 'access-control-allow-origin': '*' },
  }));
}

// Legacy view tests are not home-summary tests. Keep their incidental home visits
// local and return an explicitly empty public summary instead of reaching production.
export async function mockHomeSummary(page) {
  await page.route('**/rest/v1/rpc/home_summary', route => {
    const menus = route.request().postDataJSON()?.p_menus || [];
    const now = new Date().toISOString();
    return route.fulfill({json:{version:1,as_of:now,date:new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10),timezone:'Asia/Seoul',menus,recent:[],counts:Object.fromEntries(menus.map(m=>[m,{today:0,total:0}])),today_comments:0},headers:{'access-control-allow-origin':'*'}});
  });
}
