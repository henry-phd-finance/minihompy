import {readFile,open,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {validateConfig,request} from './identity-setup.mjs';
export const folderVisibilityMigrations=['202609240001_content_folders.sql','202609240002_content_visibility.sql','202609240003_visibility_summary.sql','202609240004_photo_media.sql','202609240005_photo_media_safeupdate.sql'];
const markers=['private.content_folder_state','private.photo_media_state','public.home_summary(text[])','private.photo_assets'];
const literal=s=>"'"+s.replaceAll("'","''")+"'";
export async function applyFolderVisibilityMigrations({target,query,log=console.log}){
 const files=await Promise.all(folderVisibilityMigrations.map(async name=>{const sql=await readFile(join(target,'supabase/migrations',name),'utf8');return {name,sql,hash:createHash('sha256').update(sql).digest('hex')};}));
 const [base]=await query("select to_regclass('private.member_writing_families') is not null and to_regprocedure('public.home_summary(text[])') is not null and to_regprocedure('public.visit_stats()') is not null as ready");
 if(!base?.ready)throw Error('회원 세션·홈 데이터 DB를 먼저 준비해 주세요.');
 await query('create table if not exists private.minihompy_setup_migrations(name text primary key,sha256 text not null); revoke all on private.minihompy_setup_migrations from public,anon,authenticated;');
 const applied=await query('select name,sha256 from private.minihompy_setup_migrations');
 for(const [i,f] of files.entries()){
  const prior=applied.find(r=>r.name===f.name);
  if(prior&&prior.sha256!==f.hash)throw Error('이미 적용된 공개범위 마이그레이션의 해시가 다릅니다.');
  // The summary function predates this upgrade; other markers uniquely identify these migrations.
  if(!prior&&i!==2&&i<4){const [r]=await query(`select to_regclass(${literal(markers[i])}) is not null as present`);if(r.present)throw Error('추적되지 않은 공개범위 스키마입니다. 적용 이력을 확인해 주세요.');}
 }
 for(const f of files){
  if(applied.some(r=>r.name===f.name))continue;
  const body=f.sql.replace(/^\s*begin;\s*$/gmi,'').replace(/^\s*commit;\s*$/gmi,'');
  await query(`begin;select pg_advisory_xact_lock(87241032);${body}\ninsert into private.minihompy_setup_migrations values(${literal(f.name)},${literal(f.hash)});commit;`);
  log('공개범위 마이그레이션 적용: '+f.name);
 }
}
export async function deployFolderVisibility(c,token,target){
 for(const name of ['member-writing','photo-media'])await new Promise((done,reject)=>{
  const child=spawn('supabase',['functions','deploy',name,'--project-ref',c.projectRef,'--use-api','--no-verify-jwt'],{cwd:target,env:{...process.env,SUPABASE_ACCESS_TOKEN:token},stdio:'ignore'});
  child.on('error',()=>reject(Error('Supabase CLI 실행 실패')));child.on('close',code=>code===0?done():reject(Error(name+' 배포 실패')));
 });
}
export async function upgradeFolderVisibility({config,target,email,password,managementToken,dryRun=false,fetcher=fetch,deploy=deployFolderVisibility,log=console.log}){
 const c=validateConfig(config);target=resolve(target);
 const html=await readFile(join(target,'index.html'),'utf8');
 for(const file of ['content-access.js','content-folders-repository.js','content-folders.js','photo-media-client.js','photos-repository.js','photo-editor.js']){
  await readFile(join(target,file));if(!html.includes(`src="${file}"`))throw Error('공개범위 런타임 연결이 필요합니다: '+file);
 }
 for(const file of ['supabase/functions/photo-media/index.ts','supabase/functions/photo-media/handler.js','supabase/functions/photo-media/io.js','supabase/functions/member-writing/handler.js',...folderVisibilityMigrations.map(n=>'supabase/migrations/'+n)])await readFile(join(target,file));
 if(!(await readFile(join(target,'supabase-config.js'),'utf8')).includes(c.supabaseUrl))throw Error('런타임의 개인 Supabase 프로젝트가 다릅니다.');
 if(dryRun){log('[DRY RUN] folder-visibility: 관리자 확인 → SQL/해시 추적 → 함수 배포 → 읽기 준비 검사. 파일 전환/ready 활성화/Pages 배포 없음. 네트워크·파일 변경 없음.');return;}
 if(!email||!password||!managementToken)throw Error('개인 소유자 로그인과 Management token이 필요합니다.');
 const lockPath=join(target,'.minihompy-folder-visibility.lock');
 const lock=await open(lockPath,'wx',0o600).catch(()=>{throw Error('공개범위 설치가 이미 실행 중입니다.');});
 const call=(url,args)=>request(url,args,fetcher),base=`https://api.supabase.com/v1/projects/${c.projectRef}`;
 const manage=(path,body)=>call(base+'/'+path,{method:'POST',token:managementToken,body});let token;
 try{
  token=(await call(c.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',key:c.publishableKey,body:{email,password}}))?.access_token;
  if(!token||await call(c.supabaseUrl+'/rest/v1/rpc/is_minihompy_admin',{method:'POST',token,key:c.publishableKey,body:{}})!==true)throw Error('기존 관리자 계정이 아닙니다.');
  const query=sql=>manage('database/query',{query:sql});
  await applyFolderVisibilityMigrations({target,query,log});
  await manage('secrets',[{name:'MINIHOMPY_SITE_ORIGIN',value:c.origin},{name:'MINIHOMPY_PUBLIC_KEY',value:c.publishableKey}]);
  await deploy(c,managementToken,target);
  const probe=await fetcher(c.supabaseUrl+'/functions/v1/photo-media/read',{method:'POST',headers:{Origin:c.origin,apikey:c.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({post_id:'00000000-0000-4000-8000-000000000001',path:'00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.png'}),redirect:'error',signal:AbortSignal.timeout(30000)});
  const result=await probe.json();
  if(probe.status!==404||result.error?.code!=='NOT_FOUND'||probe.headers.get('access-control-allow-origin')!==c.origin||!probe.headers.get('cache-control')?.includes('no-store'))throw Error('사진 함수 준비 확인 실패');
  const [state]=await query('select mode,ready from private.photo_media_state');
  log('공개범위 서버 준비 완료. 파일 전환·공개 원본 폐쇄·실제 권한 검증 후 Pages와 ready를 전환하세요. 자동 활성화하지 않습니다.');
  return {prepared:true,mediaMode:state.mode,mediaReady:state.ready};
 }finally{
  if(token)await call(c.supabaseUrl+'/auth/v1/logout?scope=local',{method:'POST',token,key:c.publishableKey}).catch(()=>{});
  await lock.close();await unlink(lockPath);
 }
}
