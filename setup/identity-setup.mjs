import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = message => { throw Error(message); };
export function validateConfig(input) {
  const allowed = new Set(['githubUser','githubRepo','projectRef','publishableKey','handle','displayName','centralApiUrl','centralPageUrl','siteId']);
  if (!input || Object.keys(input).some(key=>!allowed.has(key))) fail('설정 파일에는 예제의 공개 필드만 넣어 주세요. 비밀번호/토큰은 환경변수로 전달합니다.');
  const c = { ...input };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(c.githubUser || '') || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(c.githubRepo || '')) fail('GitHub 사용자/저장소 이름을 확인해 주세요.');
  if (!/^[a-z]{20}$/.test(c.projectRef || '')) fail('Supabase projectRef는 소문자 20자여야 합니다.');
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(c.publishableKey || '');
  try { const parts = c.publishableKey.split('.'), claims = JSON.parse(Buffer.from(parts[1], 'base64url')); publicKey ||= parts.length === 3 && claims.role === 'anon' && claims.ref === c.projectRef; } catch {}
  if (!publicKey) fail('해당 프로젝트의 anon/publishable 공개 키만 사용할 수 있습니다.');
  if (!/^[a-z0-9._-]{2,30}$/.test(c.handle || '')) fail('handle은 소문자/숫자/./_/- 2~30자여야 합니다.');
  if (typeof c.displayName !== 'string' || !c.displayName.trim() || c.displayName.trim().length > 50 || /[\u0000-\u001f\u007f]/u.test(c.displayName)) fail('표시 이름을 확인해 주세요.');
  for (const key of ['centralApiUrl', 'centralPageUrl']) {
    const url = new URL(c[key]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('중앙 주소는 인증 정보 없는 HTTPS URL이어야 합니다.');
    c[key] = url.href.replace(/\/$/, '');
  }
  if (c.siteId && !UUID.test(c.siteId)) fail('기존 siteId의 UUID 형식을 확인해 주세요.');
  c.origin = `https://${c.githubUser}.github.io`;
  c.basePath = c.githubRepo.toLowerCase() === `${c.githubUser}.github.io` ? '/' : `/${c.githubRepo}/`;
  c.homepage = c.origin + c.basePath;
  c.supabaseUrl = `https://${c.projectRef}.supabase.co`;
  return c;
}
export function runtimeFiles(c, siteId) {
  if (siteId && !UUID.test(siteId)) fail('검증된 siteId가 필요합니다.');
  const script = (name, value) => `// Public runtime configuration. Never add credentials.\nwindow.${name} = Object.freeze(${JSON.stringify(value, null, 2)});\n`;
  return {
    'supabase-config.js': script('MINIHOMPY_SUPABASE', { url: c.supabaseUrl, publishableKey: c.publishableKey }),
    'visitor-identity-config.js': script('MINIHOMPY_VISITOR_IDENTITY_CONFIG', { enabled: Boolean(siteId), siteId: siteId || '', handle: c.handle, centralApiUrl: c.centralApiUrl, centralPageUrl: c.centralPageUrl, healthTimeoutMs:1500, guardTimeoutMs:120000 }),
  };
}
export async function request(url, { method='GET', token, key, body }={}, fetcher=fetch) {
  let response;
  try {
    response = await fetcher(url, { method, redirect:'error', signal:AbortSignal.timeout(30000), headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(key?{apikey:key}: {})}, ...(body !== undefined ? {body:JSON.stringify(body)} : {}) });
  } catch { fail('연결 실패 또는 시간 초과입니다. 같은 단계를 다시 실행해 주세요.'); }
  const data = await response.json().catch(()=>null);
  if (!response.ok) { const error=Error(`요청 실패 (HTTP ${response.status}). 설정과 해당 단계의 배포 상태를 확인해 주세요.`); error.status=response.status; throw error; }
  return data;
}
export function deployFunction(c, managementToken, target, runner=spawn) {
  return new Promise((done,reject)=>{
    // No shell interpolation, credentials in argv, Git remotes, or public files.
    const child=runner('supabase',['functions','deploy','owner-login','--project-ref',c.projectRef,'--use-api','--no-verify-jwt'],{cwd:target,env:{...process.env,SUPABASE_ACCESS_TOKEN:managementToken},stdio:'ignore'});
    child.on('error',()=>reject(Error('Supabase CLI를 설치한 뒤 다시 실행해 주세요.')));
    child.on('close',code=>code===0?done():reject(Error('owner-login 배포 실패. 대상 프로젝트와 Supabase CLI 인증을 확인해 주세요.')));
  });
}
export async function runSetup({config, command, target, email, password, managementToken, dryRun=false, fetcher=fetch, deploy=deployFunction, log=console.log}) {
  const c=validateConfig(config), root=resolve(target);
  if (!['install','register','upgrade','verify'].includes(command)) fail('install, register, upgrade, verify 중 하나를 선택해 주세요.');
  if (['install','register'].includes(command) && c.siteId) fail('기존 siteId가 있으면 upgrade를 사용해 주세요.');
  if (command==='upgrade' && !c.siteId) fail('upgrade에는 기존 siteId가 필요합니다. 새 등록으로 대체하지 않습니다.');
  for (const file of ['index.html','login/index.html','scripts/build-pages.mjs','supabase/functions/owner-login/index.ts','supabase/functions/owner-login/handler.js']) await readFile(join(root,file));
  if (dryRun) { log(`[DRY RUN] ${command}: ${c.homepage} / project ${c.projectRef}; 인증·함수 배포·등록 확인·설정 생성. 네트워크/파일/Git 변경 없음.`); return; }
  if (!email || !password || /[\r\n\u0000]/.test(email)) fail('개인 소유자 이메일과 비밀번호가 필요합니다.');
  if (command!=='verify' && !managementToken) fail('개인 프로젝트의 Supabase Management access token이 필요합니다.');
  const call=(url,options)=>request(url,options,fetcher);
  const manage=(path,body)=>call(`https://api.supabase.com/v1/projects/${c.projectRef}/${path}`,{method:'POST',token:managementToken,body});
  const query=sql=>manage('database/query',{query:sql});
  if (command==='install') {
    // Never replay old migration files against an untracked existing database.
    const [schema]=await query("select to_regclass('private.minihompy_admins') is not null as existing, to_regclass('private.minihompy_setup_migrations') is not null as tracked");
    if (schema.existing && !schema.tracked) fail('기존 DB입니다. install 대신 upgrade를 사용해 주세요.');
    await query('create schema if not exists private; create table if not exists private.minihompy_setup_migrations(name text primary key, sha256 text not null); revoke all on private.minihompy_setup_migrations from public, anon, authenticated;');
    const applied=await query('select name, sha256 from private.minihompy_setup_migrations');
    for (const name of (await readdir(join(root,'supabase/migrations'))).filter(n=>/^\d+_[a-z0-9_]+\.sql$/.test(n)).sort()) {
      const sql=await readFile(join(root,'supabase/migrations',name),'utf8'), hash=createHash('sha256').update(sql).digest('hex');
      const prior=applied.find(row=>row.name===name);
      if (prior) { if(prior.sha256!==hash)fail('이미 적용된 마이그레이션 내용이 변경되었습니다.'); continue; }
      const body=sql.replace(/^\s*begin;\s*$/gmi,'').replace(/^\s*commit;\s*$/gmi,'');
      await query(`begin; select pg_advisory_xact_lock(87241032); ${body}\ninsert into private.minihompy_setup_migrations values ('${name}','${hash}'); commit;`);
      log(`마이그레이션 적용: ${name}`);
    }
  }
  let session;
  const login=()=>call(`${c.supabaseUrl}/auth/v1/token?grant_type=password`,{method:'POST',key:c.publishableKey,body:{email,password}});
  try { session=await login(); }
  catch(error) {
    if(command!=='install' || ![400,401].includes(error.status))throw error;
    const keys=await call(`https://api.supabase.com/v1/projects/${c.projectRef}/api-keys`,{token:managementToken});
    const secret=keys.find(k=>k.name==='service_role')?.api_key;
    if(!secret)fail('개인 프로젝트의 service_role 키를 확인하지 못했습니다.');
    await call(`${c.supabaseUrl}/auth/v1/admin/users`,{method:'POST',token:secret,key:secret,body:{email,password,email_confirm:true}});
    session=await login();
  }
  const token=session?.access_token;
  if(!token)fail('개인 로그인 증명을 받지 못했습니다.');
  const user=await call(`${c.supabaseUrl}/auth/v1/user`,{token,key:c.publishableKey});
  if(!UUID.test(user?.id||'') || user.is_anonymous!==false || user.role!=='authenticated')fail('영구 소유자 계정으로 로그인해 주세요.');
  if(command==='install') {
    const admins=await query('select user_id from private.minihompy_admins');
    if(admins.some(row=>row.user_id!==user.id))fail('다른 관리자가 등록되어 있습니다. 기존 소유자 연결은 변경하지 않습니다.');
    await query(`insert into private.minihompy_admins(user_id) values ('${user.id}') on conflict do nothing;`);
    await call(`https://api.supabase.com/v1/projects/${c.projectRef}/config/auth`,{method:'PATCH',token:managementToken,body:{external_anonymous_users_enabled:true}});
  }
  const admin=await call(`${c.supabaseUrl}/rest/v1/rpc/is_minihompy_admin`,{method:'POST',token,key:c.publishableKey,body:{}});
  if(admin!==true)fail('이 계정은 기존 개인 미니홈피 관리자가 아닙니다.');
  const statePath=join(root,'.minihompy-registration.json');
  if(command!=='verify') {
    const pending=await call(`${c.centralApiUrl}${command==='upgrade'?'/sites/reverify':'/sites'}`,{method:'POST',token,body:command==='upgrade'?{site_id:c.siteId,supabase_publishable_key:c.publishableKey}:{handle:c.handle,display_name:c.displayName,origin:c.origin,base_path:c.basePath,homepage_url:c.homepage,login_url:c.homepage+'login/',supabase_project_ref:c.projectRef,supabase_publishable_key:c.publishableKey}});
    if(!UUID.test(pending?.registration_id||'') || pending.verification_file?.registration_id!==pending.registration_id || !/^[A-Za-z0-9_-]{43}$/.test(pending.verification_file?.challenge||''))fail('중앙 확인 파일 응답이 올바르지 않습니다.');
    const relative=`minihompy-identity/${pending.registration_id}.json`;
    if(pending.verification_url!==c.homepage+relative)fail('기존 등록 주소와 입력한 Pages 주소가 다릅니다. 설정을 확인해 주세요.');
    await manage('secrets',[
      {name:'MINIHOMPY_OWNER_EMAIL',value:email}, {name:'MINIHOMPY_OWNER_ID',value:user.id},
      {name:'MINIHOMPY_SITE_ORIGIN',value:c.origin}, {name:'MINIHOMPY_PUBLIC_KEY',value:c.publishableKey},
    ]);
    await deploy(c,managementToken,root);
    // Confirm the deployed personal mapping before publishing the pending proof.
    const proof=await call(`${c.supabaseUrl}/functions/v1/owner-login`,{method:'POST',key:c.publishableKey,body:{password}});
    if(!proof.access_token)fail('배포한 개인 로그인 함수를 확인하지 못했습니다.');
    const mapped=await call(`${c.supabaseUrl}/auth/v1/user`,{token:proof.access_token,key:c.publishableKey});
    if(mapped?.id!==user.id)fail('배포된 로그인 함수의 소유자가 다릅니다.');
    await mkdir(join(root,'minihompy-identity'),{recursive:true});
    await writeFile(join(root,relative),JSON.stringify(pending.verification_file)+'\n');
    await writeFile(statePath,JSON.stringify({version:1,config:c,registrationId:pending.registration_id,expiresAt:pending.expires_at},null,2)+'\n',{mode:0o600});
    if(['install','register'].includes(command))for(const [name,content] of Object.entries(runtimeFiles(c,null)))await writeFile(join(root,name),content);
    log(`등록 대기: ${relative} 파일과 새 런타임 코드를 commit/push해 Pages에 배포한 후 verify를 실행하세요. (기한: ${pending.expires_at})`);
    return {status:'pending',registrationId:pending.registration_id};
  }
  const saved=JSON.parse(await readFile(statePath,'utf8'));
  if(!UUID.test(saved.registrationId||'') || Object.entries(c).some(([key,value])=>saved.config?.[key]!==value))fail('등록 대기 파일과 입력 설정이 다릅니다.');
  if(!saved.verified && (!Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt)<=Date.now()))fail('등록 요청이 만료되었습니다. install/upgrade에서 새 확인 파일을 발급받으세요.');
  const result=saved.verified || await call(`${c.centralApiUrl}/sites/verify`,{method:'POST',token,body:{registration_id:saved.registrationId}});
  if(!UUID.test(result?.site_id||'') || (c.siteId && result.site_id!==c.siteId))fail('검증 응답의 siteId가 올바르지 않습니다.');
  // Save consumed result first, so file generation can be retried without consuming twice.
  await writeFile(statePath,JSON.stringify({...saved,verified:result},null,2)+'\n',{mode:0o600});
  for(const [name,content] of Object.entries(runtimeFiles({...c,handle:result.handle || c.handle},result.site_id)))await writeFile(join(root,name),content);
  log(`중앙 검증 완료: ${result.site_id}. 생성된 두 설정 파일을 commit/push하면 연동이 활성화됩니다.`);
  return result;
}
