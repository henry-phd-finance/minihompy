import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateConfig,request} from './identity-setup.mjs';
export const writingMigrations=['202609230001_member_writing_foundation.sql','202609230002_member_writing_sessions.sql','202609230003_member_guestbook.sql','202609230004_member_comments.sql','202609230009_member_session_renewal.sql'];
const literal=s=>"'"+s.replaceAll("'","''")+"'";
export async function applyWritingMigrations({target,query,log=console.log}){
 const [schema]=await query("select to_regclass('public.guestbook_posts') is not null and to_regclass('public.post_comments') is not null and to_regprocedure('private.guard_comment()') is not null as ready, exists(select 1 from information_schema.columns where table_schema='public' and table_name='guestbook_posts' and column_name='author_kind') as member_columns");
 if(!schema?.ready)throw Error('기존 콘텐츠 DB 마이그레이션을 먼저 적용해 주세요.');
 await query('create table if not exists private.minihompy_setup_migrations(name text primary key,sha256 text not null); revoke all on private.minihompy_setup_migrations from public,anon,authenticated;');
 const applied=await query('select name,sha256 from private.minihompy_setup_migrations');
 if(schema.member_columns && !applied.some(r=>r.name===writingMigrations[0]))throw Error('추적되지 않은 회원 스키마입니다. 적용 이력을 확인한 뒤 진행해 주세요.');
 const [renewal]=await query("select to_regclass('private.member_writing_families') is not null as exists");
 if(renewal.exists&&!applied.some(r=>r.name===writingMigrations.at(-1)))throw Error('추적되지 않은 자동 갱신 스키마입니다. 적용 이력을 확인해 주세요.');
 for(const name of writingMigrations){
  const sql=await readFile(join(target,'supabase/migrations',name),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
  const prior=applied.find(r=>r.name===name);
  if(prior){if(prior.sha256!==hash)throw Error('이미 적용된 회원 마이그레이션의 해시가 다릅니다.');continue;}
  const body=sql.replace(/^\s*begin;\s*$/gmi,'').replace(/^\s*commit;\s*$/gmi,'');
  await query(`begin;select pg_advisory_xact_lock(87241032);${body}\ninsert into private.minihompy_setup_migrations values(${literal(name)},${literal(hash)});commit;`);
  log('회원 마이그레이션 적용: '+name);
 }
}
export function deployWriting(c,token,target){return new Promise((done,reject)=>{
 const child=spawn('supabase',['functions','deploy','member-writing','--project-ref',c.projectRef,'--use-api','--no-verify-jwt'],{cwd:target,env:{...process.env,SUPABASE_ACCESS_TOKEN:token},stdio:'ignore'});
 child.on('error',()=>reject(Error('Supabase CLI 실행 실패')));child.on('close',code=>code===0?done():reject(Error('member-writing 배포 실패')));
});}
export async function upgradeMemberWriting({config,target,email,password,managementToken,dryRun=false,fetcher=fetch,deploy=deployWriting,log=console.log}){
 const c=validateConfig(config);target=resolve(target);
 if(!c.siteId)throw Error('중앙 검증이 끝난 siteId가 필요합니다. 신규 설치는 verify 이후 실행하세요.');
 for(const file of ['member-writing-runtime.js','login/writing.html','supabase/functions/member-writing/index.ts',...writingMigrations.map(n=>'supabase/migrations/'+n)])await readFile(join(target,file));
 if(dryRun){log(`[DRY RUN] writing: ${c.homepage} / ${c.projectRef}; 중앙·소유자 확인 → 추가 마이그레이션 → 고정 사이트 설정 → 함수 → 활성화 파일. 변경 없음.`);return;}
 if(!email||!password||!managementToken)throw Error('개인 소유자 로그인과 Management token이 필요합니다.');
 const call=(url,args)=>request(url,args,fetcher),base=`https://api.supabase.com/v1/projects/${c.projectRef}`;
 const manage=(path,body)=>call(base+'/'+path,{method:'POST',token:managementToken,body});
 const health=await call(c.centralApiUrl+'/health');if(health?.writing_protocol!==1||health?.member_session_protocol!==2)throw Error('중앙 회원 작성 서버를 먼저 배포해 주세요.');
 const session=await call(c.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',key:c.publishableKey,body:{email,password}});
 const token=session?.access_token;if(!token)throw Error('소유자 인증 실패');
 try{
  const admin=await call(c.supabaseUrl+'/rest/v1/rpc/is_minihompy_admin',{method:'POST',token,key:c.publishableKey,body:{}});if(admin!==true)throw Error('기존 관리자 계정이 아닙니다.');
  const intent=await call(c.centralApiUrl+'/login-intents',{method:'POST',body:{site_id:c.siteId,return_site_id:c.siteId,return_path:c.basePath,code_challenge:createHash('sha256').update(randomBytes(32)).digest('base64url')}});
  const loginUrl=new URL(intent.login_url);
  if(loginUrl.origin!==c.origin || loginUrl.username || loginUrl.password || loginUrl.hash || ![c.basePath,c.basePath+'login/'].includes(loginUrl.pathname) || [...loginUrl.searchParams].some(([k,v])=>k!=='login_intent'||v!==''))throw Error('등록된 미니홈피 주소가 다릅니다.');
  // Prove the personal Auth owner matches the central binding; never send password.
  await call(c.centralApiUrl+'/activation-tickets',{method:'POST',token,body:{login_intent:intent.login_intent,site_id:c.siteId}});
  const query=sql=>manage('database/query',{query:sql});
  await applyWritingMigrations({target,query,log});
  await query(`do $$ begin if exists(select 1 from private.member_writing_site where site_id<>${literal(c.siteId)}::uuid or central_api_url<>${literal(c.centralApiUrl)}) then raise exception 'Existing writing binding differs';end if;end $$;insert into private.member_writing_site(site_id,central_api_url) values(${literal(c.siteId)}::uuid,${literal(c.centralApiUrl)}) on conflict(singleton) do nothing;`);
  await manage('secrets',[{name:'MINIHOMPY_SITE_ID',value:c.siteId},{name:'MINIHOMPY_SITE_ORIGIN',value:c.origin},{name:'MINIHOMPY_CENTRAL_API_URL',value:c.centralApiUrl},{name:'MINIHOMPY_PUBLIC_KEY',value:c.publishableKey}]);
  await deploy(c,managementToken,target);
  // Explicit mode header is mandatory; use the transport directly for this probe.
  const response=await fetcher(c.supabaseUrl+'/functions/v1/member-writing/sessions/current',{headers:{Authorization:'Bearer '+token,'X-Minihompy-Auth-Mode':'owner'},redirect:'error',signal:AbortSignal.timeout(30000)});
  const actor=await response.json();if(!response.ok||actor.actor?.kind!=='owner')throw Error('배포된 작성 함수의 관리자 확인 실패');
  const renewalProbe=await fetcher(c.supabaseUrl+'/functions/v1/member-writing/sessions/renew',{method:'POST',headers:{'Content-Type':'application/json','X-Minihompy-Auth-Mode':'member',Authorization:'Bearer '+randomBytes(32).toString('base64url')},body:'{}',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(renewalProbe.status!==401)throw Error('배포된 자동 갱신 함수 확인 실패');
  await writeFile(join(target,'member-writing-config.js'),'// Enable only after central and personal migrations/functions have been deployed.\nwindow.MINIHOMPY_MEMBER_WRITING_CONFIG = Object.freeze({ enabled: true });\n');
  log('회원 작성 준비 완료. 런타임과 member-writing-config.js를 Pages에 배포하세요.');return {siteId:c.siteId,ready:true};
 }finally{await call(c.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',token,key:c.publishableKey}).catch(()=>{});}
}
