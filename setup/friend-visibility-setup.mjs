import {readFile,open,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {validateConfig,request,UUID} from './identity-setup.mjs';
import {deployFolderVisibility} from './folder-visibility-setup.mjs';
import {friendPagesRelease,sha256} from './friend-visibility-release.mjs';
export const friendVisibilityMigrations=['202609240007_friend_visibility.sql','202609240008_friend_comments.sql','202609240009_friend_photo_media.sql','202609240010_friend_aggregates.sql','202609240011_friend_diary_filters.sql','202609240012_friend_visibility_deployment.sql','202609270001_diary_latest.sql','202609270002_photo_check.sql'];
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
const markers=["to_regclass('private.friend_visibility_state') is not null","to_regprocedure('public.member_content_comments(text,jsonb)') is not null","to_regprocedure('public.member_photo_read(text,jsonb)') is not null","to_regprocedure('public.member_content_aggregate(text,jsonb)') is not null","position('day_date date' in coalesce(pg_get_functiondef(to_regprocedure('public.member_content_read(text,jsonb)')),''))>0","to_regclass('private.friend_visibility_deployment') is not null","position('latest boolean' in coalesce(pg_get_functiondef(to_regprocedure('public.member_content_read(text,jsonb)')),''))>0","to_regprocedure('public.member_photo_check(text,jsonb)') is not null"];
export async function applyFriendVisibilityMigrations({target,query,checkOnly=false,log=console.log}){
 const files=await Promise.all(friendVisibilityMigrations.map(async name=>{const sql=await readFile(join(target,'supabase/migrations',name),'utf8');return {name,sql,hash:sha256(sql)};}));
 const [base]=await query("select to_regclass('private.member_writing_families') is not null and to_regclass('private.photo_assets') is not null and to_regclass('private.friend_reviews') is not null as ready");
 if(!base?.ready)throw Error('회원 세션·사진 보호·일촌평 DB를 먼저 준비하세요.');
 await query('create table if not exists private.minihompy_setup_migrations(name text primary key,sha256 text not null);revoke all on private.minihompy_setup_migrations from public,anon,authenticated,service_role;');
 const applied=await query('select name,sha256 from private.minihompy_setup_migrations');
 const [state]=await query('select '+markers.map((m,i)=>`(${m}) as m${i}`).join(','));
 for(const [i,f] of files.entries()){
  const prior=applied.find(r=>r.name===f.name);
  if(prior&&(prior.sha256!==f.hash||!state['m'+i]))throw Error('일촌 공개 적용 이력/해시/스키마가 다릅니다: '+f.name);
  if(!prior&&state['m'+i])throw Error('추적되지 않은 일촌 공개 스키마입니다: '+f.name);
  if(checkOnly&&!prior)throw Error('먼저 friend-visibility prepare를 완료하세요.');
 }
 if(checkOnly)return;
 for(const f of files){if(applied.some(r=>r.name===f.name))continue;
  await query(`begin;select pg_advisory_xact_lock(87241032);${f.sql.replace(/^\s*(?:begin|commit);\s*$/gmi,'')}\ninsert into private.minihompy_setup_migrations values(${literal(f.name)},${literal(f.hash)});commit;`);
  log('일촌 공개 migration 적용: '+f.name);
 }
}
export async function disableFriendVisibility({query,siteId,centralApiUrl}){
 const epoch=randomUUID();await query(`begin;select pg_advisory_xact_lock(87241032);
 do $$ begin if not exists(select 1 from private.member_writing_site where site_id=${literal(siteId)}::uuid and central_api_url=${literal(centralApiUrl)}) then raise exception 'Existing site binding differs';end if;end $$;
 update private.friend_visibility_deployment set epoch=${literal(epoch)}::uuid,pages_sha256=null,changed_at=clock_timestamp();
 update private.friend_visibility_state set ready=false,media_ready=false,summary_ready=false,pages_ready=false;
 commit;`);
 return epoch;
}
export async function activateFriendVisibility({query,siteId,centralApiUrl,ownerId,epoch,pagesHash}){
 if(!UUID.test(ownerId)||!UUID.test(epoch)||!/^[a-f0-9]{64}$/.test(pagesHash))throw Error('Invalid activation evidence');
 await query(`begin;select pg_advisory_xact_lock(87241032);
 do $$ begin
 if not exists(select 1 from private.friend_visibility_deployment where epoch=${literal(epoch)}::uuid for update)
 or not exists(select 1 from private.member_writing_site where site_id=${literal(siteId)}::uuid and central_api_url=${literal(centralApiUrl)})
 or not exists(select 1 from private.photo_media_state where ready and mode='protected' for share)
 or not exists(select 1 from storage.buckets where id='minihompy-photos-private' and not public for share)
 or exists(select 1 from storage.buckets where id='minihompy-photos' and public for share)
 or not exists(select 1 from private.friend_visibility_state where owner_member_id is null or owner_member_id=${literal(ownerId)}::uuid for update)
 then raise exception 'Activation fence or binding/media check failed';end if;
 end $$;
 update private.friend_visibility_state set owner_member_id=${literal(ownerId)}::uuid,media_ready=true,summary_ready=true,pages_ready=true,ready=true;
 update private.friend_visibility_deployment set pages_sha256=${literal(pagesHash)},changed_at=clock_timestamp();commit;`);
}
async function centralOwner(c,token,fetcher){
 const call=(url,args)=>request(url,args,fetcher);
 const health=await call(c.centralApiUrl+'/health');
 if(health.friend_visibility_protocol!==1||health.relationship_protocol!==1||health.member_session_protocol!==2)throw Error('중앙 일촌 공개/세션 서버를 먼저 준비하세요.');
 const intent=await call(c.centralApiUrl+'/login-intents',{method:'POST',body:{site_id:c.siteId,return_site_id:c.siteId,return_path:c.basePath,code_challenge:Buffer.from(sha256(randomBytes(32)),'hex').toString('base64url')}});
 const u=new URL(intent.login_url);if(u.origin!==c.origin||u.username||u.password||u.hash||![c.basePath,c.basePath+'login/'].includes(u.pathname))throw Error('중앙 사이트 주소가 다릅니다.');
 // The trusted central HTTPS endpoint validates this personal owner's Auth token and binding.
 const ticket=await call(c.centralApiUrl+'/activation-tickets',{method:'POST',token,body:{site_id:c.siteId,login_intent:intent.login_intent}});
 let claims;try{claims=JSON.parse(Buffer.from(ticket.activation_ticket.split('.')[1],'base64url'));}catch{throw Error('중앙 소유자 확인 실패');}
 if(claims.kind!=='activation_ticket'||claims.site_id!==c.siteId||!UUID.test(claims.sub)||claims.exp<=Date.now()/1000||!Number.isFinite(claims.exp))throw Error('중앙 소유자 결합 확인 실패');
 return claims.sub;
}
async function probe(c,fetcher,token){
 const options={headers:{Origin:c.origin,'X-Minihompy-Auth-Mode':'public'},redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)};
 const results=[];
 for(const suffix of ['member-writing/content/health','photo-media/health']){
  const r=await fetcher(c.supabaseUrl+'/functions/v1/'+suffix,options),h=await r.json();
  if(!r.ok||r.headers.get('access-control-allow-origin')!==c.origin||!r.headers.get('cache-control')?.includes('no-store')||h.friend_visibility_setup_protocol!==1)throw Error('개인 함수 capability/CORS/no-store 확인 실패');results.push(h);
 }
 if(results[0].friend_visibility_protocol!==1||results[1].friend_media_protocol!==1||results[1].site_id!==c.siteId||results[1].central_api_url!==c.centralApiUrl||results[1].project_url!==c.supabaseUrl)throw Error('개인 읽기/사진 protocol 확인 실패');
 const r=await fetcher(c.supabaseUrl+'/functions/v1/member-writing/content/list',{...options,method:'POST',headers:{...options.headers,'Content-Type':'application/json','X-Minihompy-Auth-Mode':'owner',Authorization:'Bearer '+token},body:JSON.stringify({kind:'board',size:1})}),body=await r.json();
 if(!r.ok||body.protocol!==1||body.view?.mode!=='owner'||!Array.isArray(body.data?.items))throw Error('개인 함수의 관리자/DB 조회 확인 실패');
 return results[0];
}
async function verifyPages(c,target,fetcher){
 const expected=await friendPagesRelease(target),options={redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)};
 const get=async name=>{const r=await fetcher(new URL(name,c.homepage).href,options);if(!r.ok)throw Error('Pages 배포 파일 확인 실패: '+name);return Buffer.from(await r.arrayBuffer());};
 let served;try{served=JSON.parse((await get('friend-visibility-release.json')).toString());}catch{throw Error('Pages 일촌 공개 release 확인 실패');}
 if(served.protocol!==1||served.sha256!==expected.sha256||JSON.stringify(served.files)!==JSON.stringify(expected.files))throw Error('Pages release가 검증할 소스와 다릅니다.');
 for(const [name,hash] of Object.entries(expected.files))if(sha256(await get(name))!==hash)throw Error('Pages 파일 해시 불일치: '+name);
 const config=(name,global)=>{const raw=readFile(join(target,name),'utf8');return raw.then(s=>{const match=s.match(new RegExp('window\\.'+global+'\\s*=\\s*Object\\.freeze\\((\\{[\\s\\S]*?\\})\\)'));if(!match)throw Error('런타임 설정 형식 오류');return JSON.parse(match[1]);});};
 const local=await config('supabase-config.js','MINIHOMPY_SUPABASE'),identity=await config('visitor-identity-config.js','MINIHOMPY_VISITOR_IDENTITY_CONFIG');
 if(local.url!==c.supabaseUrl||local.publishableKey!==c.publishableKey||identity.siteId!==c.siteId||identity.centralApiUrl!==c.centralApiUrl||identity.centralPageUrl!==c.centralPageUrl||identity.enabled!==true||!/window\.MINIHOMPY_MEMBER_WRITING_CONFIG\s*=\s*Object\.freeze\(\{\s*(?:"enabled"|enabled)\s*:\s*true\s*,?\s*\}\)/.test(await readFile(join(target,'member-writing-config.js'),'utf8')))throw Error('Pages 사이트/공통 세션 설정이 다릅니다.');
 return expected.sha256;
}
export async function upgradeFriendVisibility({config,target,email,password,managementToken,phase='prepare',dryRun=false,fetcher=fetch,deploy=deployFolderVisibility,log=console.log}){
 const c=validateConfig(config);target=resolve(target);
 if(!c.siteId||!['prepare','activate','disable'].includes(phase))throw Error('검증된 siteId와 prepare/activate/disable 단계가 필요합니다.');
 if(phase!=='disable'){
  await friendPagesRelease(target);
  for(const file of ['supabase/functions/member-writing/content-read.js','supabase/functions/member-writing/aggregate-schema.js','supabase/functions/photo-media/member-read.js',...friendVisibilityMigrations.map(f=>'supabase/migrations/'+f)])await readFile(join(target,file));
 }
 if(dryRun){log('[DRY RUN] friend-visibility '+phase+': 소유자/사이트 확인, 추적된 SQL, 함수와 Pages 해시 확인. 네트워크·파일·운영 변경 없음.');return;}
 if(!email||!password||!managementToken)throw Error('개인 소유자 로그인과 Management token이 필요합니다.');
 const lockPath=join(target,'.minihompy-friend-visibility.lock'),lock=await open(lockPath,'wx',0o600).catch(()=>{throw Error('일촌 공개 준비/활성화가 이미 실행 중입니다.');});
 const call=(url,args)=>request(url,args,fetcher),query=sql=>call(`https://api.supabase.com/v1/projects/${c.projectRef}/database/query`,{method:'POST',token:managementToken,body:{query:sql}});let token;
 try{
  token=(await call(c.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',key:c.publishableKey,body:{email,password}}))?.access_token;
  if(!token||await call(c.supabaseUrl+'/rest/v1/rpc/is_minihompy_admin',{method:'POST',token,key:c.publishableKey,body:{}})!==true)throw Error('개인 관리자 확인 실패');
  if(phase==='disable'){await disableFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl});log('일촌 공개 비활성화 완료. 데이터·파일·DB 보호 정책은 유지합니다.');return {ready:false};}
  const ownerId=await centralOwner(c,token,fetcher);
  const [binding]=await query(`select site_id::text,central_api_url from private.member_writing_site`);
  if(binding?.site_id!==c.siteId||binding.central_api_url!==c.centralApiUrl)throw Error('기존 개인 사이트 결합이 다릅니다.');
  await applyFriendVisibilityMigrations({target,query,checkOnly:phase==='activate',log});
  const epoch=await disableFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl});
  if(phase==='prepare'){
   await deploy(c,managementToken,target);await probe(c,fetcher,token);
   log('개인 서버 준비 완료. 아직 friends 저장은 차단됩니다. 새 Pages를 배포한 뒤 activate를 실행하세요.');return {ready:false,prepared:true};
  }
  await probe(c,fetcher,token);const pagesHash=await verifyPages(c,target,fetcher);
  // Recheck central binding after potentially slow Pages transfers, before publishing readiness.
  if(await centralOwner(c,token,fetcher)!==ownerId)throw Error('중앙 소유자가 변경되었습니다.');
  try{await activateFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl,ownerId,epoch,pagesHash});const h=await probe(c,fetcher,token);if(!h.friend_visibility_ready||!h.friend_media_ready||!h.friend_summary_ready||!h.friend_pages_ready)throw Error('활성화 최종 probe 실패');}
  catch(e){await disableFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl});throw e;}
  log('일촌 공개 활성화 완료. 실제 회원/권한 검증은 별도로 수행하세요.');return {ready:true,pagesHash};
 }finally{if(token)await call(c.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',token,key:c.publishableKey}).catch(()=>{});await lock.close();await unlink(lockPath);}
}
