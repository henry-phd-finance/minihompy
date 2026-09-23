// Single-owner password endpoint. Never log requests, credentials, or Auth responses.
function env(name) { return globalThis.Deno?.env?.get(name) ?? globalThis.process?.env?.[name]; }
export async function handleOwnerLogin(req, options = {}) {
  const setting = name => options.config?.[name] ?? env(name);
  const siteOrigin = setting('MINIHOMPY_SITE_ORIGIN');
  const origin = req.headers.get('Origin');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, apikey' };
  if (origin && origin === siteOrigin) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (!siteOrigin) return reply(503, { error: '개인 로그인 설정이 필요합니다.' });
  if (origin && origin !== siteOrigin) return reply(403, { error: '허용되지 않은 사이트입니다.' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST 요청이 필요합니다.' });
  const email = setting('MINIHOMPY_OWNER_EMAIL'), owner = setting('MINIHOMPY_OWNER_ID');
  const projectUrl = setting('SUPABASE_URL'), key = setting('MINIHOMPY_PUBLIC_KEY') || setting('SUPABASE_ANON_KEY');
  if (!email || !owner || !key || !/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(projectUrl || '')) {
    return reply(503, { error: '개인 로그인 설정이 필요합니다.' });
  }
  let password;
  try {
    if (!req.headers.get('Content-Type')?.startsWith('application/json')) throw Error();
    const reader = req.body?.getReader(); if (!reader) throw Error();
    const chunks = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8192) throw Error(); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || Object.keys(body).some(key => key !== 'password') || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw Error();
    password = body.password;
  } catch { return reply(400, { error: '비밀번호를 입력해 주세요.' }); }
  const fetcher = options.fetcher || fetch;
  const api = projectUrl.replace(/\/$/, '');
  try {
    const response = await fetcher(`${api}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    password = null;
    if (!response.ok) return reply(response.status === 429 ? 429 : response.status >= 500 ? 503 : 401,
      { error: response.status === 429 ? '잠시 후 다시 시도해 주세요.' : '로그인하지 못했습니다. 비밀번호를 확인해 주세요.' });
    const session = await response.json();
    if (session.user?.id !== owner || session.user?.is_anonymous !== false || !session.access_token || !session.refresh_token) {
      return reply(403, { error: '등록된 소유자 계정이 아닙니다.' });
    }
    const permission = await fetcher(`${api}/rest/v1/rpc/is_minihompy_admin`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!permission.ok || await permission.json() !== true) return reply(403, { error: '소유자 권한을 확인하지 못했습니다.' });
    return reply(200, { access_token: session.access_token, refresh_token: session.refresh_token });
  } catch { return reply(503, { error: '연결 상태를 확인한 뒤 다시 시도해 주세요.' }); }
}
