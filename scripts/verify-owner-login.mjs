import assert from 'node:assert/strict';
import { handleOwnerLogin } from '../supabase/functions/owner-login/handler.js';
const config = { MINIHOMPY_SITE_ORIGIN: 'https://alice.github.io', MINIHOMPY_OWNER_EMAIL: 'owner@example.test',
  MINIHOMPY_OWNER_ID: '11111111-1111-4111-8111-111111111111', SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', MINIHOMPY_PUBLIC_KEY: 'sb_publishable_test' };
let mode = 'success', calls = [];
const fetcher = async (url, init) => {
  calls.push({ url, init }); assert.equal(new URL(url).origin, config.SUPABASE_URL); assert.equal(init.redirect, 'error');
  if (mode === 'offline') throw Error('secret remote details');
  if (url.includes('/auth/v1/token')) {
    assert.deepEqual(JSON.parse(init.body), { email: config.MINIHOMPY_OWNER_EMAIL, password: 'correct-password' });
    if (mode === 'wrong') return Response.json({ message: 'do not disclose' }, { status: 400 });
    if (mode === 'rate') return new Response('', { status: 429 });
    return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', user: { id: mode === 'other' ? 'another' : config.MINIHOMPY_OWNER_ID, is_anonymous: false } });
  }
  assert.equal(JSON.parse(init.body).password, undefined);
  return Response.json(mode !== 'not-admin');
};
async function run(body, expected, overrides = {}) {
  const response = await handleOwnerLogin(new Request('https://aaaaaaaaaaaaaaaaaaaa.supabase.co/functions/v1/owner-login', {
    method: 'POST', headers: { Origin: overrides.origin || config.MINIHOMPY_SITE_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { config: { ...config, ...overrides.config }, fetcher });
  assert.equal(response.status, expected); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const data = await response.json(); assert.ok(!JSON.stringify(data).includes(config.MINIHOMPY_OWNER_EMAIL)); return data;
}
await run({ password: 'correct-password' }, 403, { origin: 'https://evil.test' });
await run({ password: 'correct-password', email: 'other@test' }, 400);
await run({ password: '' }, 400);
await run({ password: 'x'.repeat(10000) }, 400);
await run({ password: 'correct-password' }, 503, { config: { MINIHOMPY_OWNER_EMAIL: '' } });
assert.equal(calls.length, 0);
for (const [testMode, status] of [['wrong',401],['rate',429],['other',403],['not-admin',403],['offline',503],['success',200]]) {
  mode = testMode; const data = await run({ password: 'correct-password' }, status);
  if (status === 200) assert.deepEqual(data, { access_token: 'access-token', refresh_token: 'refresh-token' });
  else assert.equal(data.access_token, undefined);
}
console.log('PASS: personal password endpoint confines credentials to own project, validates owner/admin, rejects account override, origin, bad password, rate limit and outages.');
