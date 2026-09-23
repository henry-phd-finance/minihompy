import {readFile,writeFile,open,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateConfig,request} from './identity-setup.mjs';
export const homeMigrations=['202609230005_home_summary.sql','202609230006_post_location.sql','202609230007_guestbook_post_location.sql','202609230008_visit_counts.sql'];
const literal=s=>"'"+s.replaceAll("'","''")+"'";
export async function applyHomeMigrations({target,query,log=console.log}){
 const [schema]=await query("select to_regprocedure('public.member_guestbook(text,jsonb)') is not null and to_regprocedure('public.member_comments(text,jsonb)') is not null as ready");
 if(!schema?.ready)throw Error('회원 작성 DB를 먼저 준비해 주세요.');
 const files=await Promise.all(homeMigrations.map(async name=>{const sql=await readFile(join(target,'supabase/migrations',name),'utf8');return {name,sql,hash:createHash('sha256').update(sql).digest('hex')};}));
 await query('create table if not exists private.minihompy_setup_migrations(name text primary key,sha256 text not null); revoke all on private.minihompy_setup_migrations from public,anon,authenticated;');
 const applied=await query('select name,sha256 from private.minihompy_setup_migrations');
 for(const f of files){const prior=applied.find(r=>r.name===f.name);if(prior&&prior.sha256!==f.hash)throw Error('이미 적용된 홈 마이그레이션의 해시가 다릅니다.');}
 for(const f of files){
  if(applied.some(r=>r.name===f.name))continue;
  const body=f.sql.replace(/^\s*begin;\s*$/gmi,'').replace(/^\s*commit;\s*$/gmi,'');
  await query(`begin;select pg_advisory_xact_lock(87241032);${body}\ninsert into private.minihompy_setup_migrations values(${literal(f.name)},${literal(f.hash)});commit;`);
  log('홈 마이그레이션 적용: '+f.name);
 }
}
export function deployVisits(c,token,target){return new Promise((done,reject)=>{
 const child=spawn('supabase',['functions','deploy','visit-counts','--project-ref',c.projectRef,'--use-api','--no-verify-jwt'],{cwd:target,env:{...process.env,SUPABASE_ACCESS_TOKEN:token},stdio:'ignore'});
 child.on('error',()=>reject(Error('Supabase CLI 실행 실패')));child.on('close',code=>code===0?done():reject(Error('visit-counts 배포 실패')));
});}
export async function upgradeHomeData({config,target,email,password,managementToken,dryRun=false,fetcher=fetch,deploy=deployVisits,log=console.log}){
 const c=validateConfig(config);target=resolve(target);
 const html=await readFile(join(target,'index.html'),'utf8');
 for(const file of ['home-data-config.js','visit-counts.js','home-repository.js','home-activity.js','post-routes.js','post-location-repository.js']){
  await readFile(join(target,file));if(!html.includes(`src="${file}"`))throw Error('홈 런타임 연결이 필요합니다: '+file);
 }
 for(const file of ['supabase/functions/visit-counts/index.ts','supabase/functions/visit-counts/handler.js',...homeMigrations.map(n=>'supabase/migrations/'+n)])await readFile(join(target,file));
 if(!(await readFile(join(target,'supabase-config.js'),'utf8')).includes(c.supabaseUrl))throw Error('런타임의 개인 Supabase 프로젝트가 다릅니다.');
 if(dryRun){log('[DRY RUN] home-data: 소유자/스키마 확인 → 홈 SQL → 기존 secret 유지 또는 최초 생성 → 함수 배포 → 읽기 검사 → 활성화. 네트워크/파일 변경 없음.');return;}
 if(!email||!password||!managementToken)throw Error('소유자 로그인과 Supabase Management token이 필요합니다.');
 const lockPath=join(target,'.minihompy-home-data.lock');
 const lock=await open(lockPath,'wx',0o600).catch(()=>{throw Error('홈 설치가 이미 실행 중입니다. 중단된 실행이라면 잠금 파일을 확인해 주세요.');});
 const call=(url,args)=>request(url,args,fetcher),base=`https://api.supabase.com/v1/projects/${c.projectRef}`;
 const manage=(path,body)=>call(base+'/'+path,{method:'POST',token:managementToken,body});
 let token;
 try{
  token=(await call(c.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',key:c.publishableKey,body:{email,password}}))?.access_token;
  if(!token||await call(c.supabaseUrl+'/rest/v1/rpc/is_minihompy_admin',{method:'POST',token,key:c.publishableKey,body:{}})!==true)throw Error('기존 관리자 계정이 아닙니다.');
  // List secret names only; never replace an existing visit secret during upgrade.
  const secrets=await call(base+'/secrets',{token:managementToken});
  if(!Array.isArray(secrets))throw Error('Secrets 준비 상태를 확인하지 못했습니다.');
  const query=sql=>manage('database/query',{query:sql});
  await applyHomeMigrations({target,query,log});
  const [stats]=await query('select public.visit_stats() as data');
  if(!secrets.some(s=>s.name==='MINIHOMPY_VISIT_SECRET')){
   if(stats?.data?.total!==0)throw Error('기존 방문 기록의 secret이 없습니다. 복구 후 다시 실행해 주세요.');
   await manage('secrets',[{name:'MINIHOMPY_VISIT_SECRET',value:randomBytes(32).toString('hex')}]);
  }
  await manage('secrets',[{name:'MINIHOMPY_SITE_ORIGIN',value:c.origin}]);
  await deploy(c,managementToken,target);
  const probe=await fetcher(c.supabaseUrl+'/functions/v1/visit-counts',{headers:{Origin:c.origin},redirect:'error',signal:AbortSignal.timeout(30000)});
  const result=await probe.json();
  if(!probe.ok||probe.headers.get('access-control-allow-origin')!==c.origin||result.version!==1||result.timezone!=='Asia/Seoul'||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.today)||result.today<0||result.total<result.today)throw Error('방문 조회 함수 준비 확인 실패');
  const summary=await call(c.supabaseUrl+'/rest/v1/rpc/home_summary',{method:'POST',key:c.publishableKey,body:{p_menus:[]}});
  if(summary?.version!==1||!Array.isArray(summary.recent))throw Error('공개 홈 요약 준비 확인 실패');
  await writeFile(join(target,'home-data-config.js'),'// Verified personal home data deployment. No credentials.\nwindow.MINIHOMPY_HOME_DATA_CONFIG = Object.freeze('+JSON.stringify({enabled:true,supabaseUrl:c.supabaseUrl,homepage:c.homepage})+');\n');
  log('홈 데이터 준비 완료. home-data-config.js와 런타임을 Pages에 배포하세요. 준비 검사는 방문 수를 늘리지 않습니다.');return {ready:true};
 }finally{
  if(token)await call(c.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',token,key:c.publishableKey}).catch(()=>{});
  await lock.close();await unlink(lockPath);
 }
}
