import {readFile,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateConfig,request} from './identity-setup.mjs';
import {upgradeMemberWriting,deployWriting} from './member-writing-setup.mjs';
export const relationshipMigration='202609240006_friend_reviews.sql';
export async function applyFriendReviews({target,query}){
 const sql=await readFile(join(target,'supabase/migrations',relationshipMigration),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
 const [state]=await query("select to_regclass('private.member_writing_families') is not null as ready,to_regclass('private.friend_reviews') is not null as installed");
 if(!state?.ready)throw Error('회원 세션 migration을 먼저 적용하세요.');
 await query('create table if not exists private.minihompy_setup_migrations(name text primary key,sha256 text not null);revoke all on private.minihompy_setup_migrations from public,anon,authenticated;');
 const rows=await query('select name,sha256 from private.minihompy_setup_migrations'),prior=rows.find(r=>r.name===relationshipMigration);
 if(prior){if(prior.sha256!==hash||!state.installed)throw Error('일촌평 적용 이력/해시가 다릅니다.');return;}
 if(state.installed)throw Error('추적되지 않은 일촌평 스키마입니다. 자동 채택하지 않습니다.');
 await query(`begin;select pg_advisory_xact_lock(87241032);${sql.replace(/^\s*(?:begin|commit);\s*$/gmi,'')}\ninsert into private.minihompy_setup_migrations values('${relationshipMigration}','${hash}');commit;`);
}
export async function upgradeMemberRelationships(options){
 const {config,dryRun=false,fetcher=fetch,deploy=deployWriting,log=console.log}=options;
 const target=resolve(options.target),c=validateConfig(config);
 if(!c.siteId)throw Error('중앙 verify 이후 relationships를 실행하세요.');
 const files=['member-relationships-repository.js','member-relationships.js','member-relationship-lists.js','friend-reviews-repository.js','friend-reviews.js'];
 const html=await readFile(join(target,'index.html'),'utf8');
 for(const file of files){await readFile(join(target,file));if(!html.includes('src="'+file+'"'))throw Error('Pages script 누락: '+file);}
 await readFile(join(target,'supabase/migrations',relationshipMigration));
 if(dryRun){log('[DRY RUN] relationships: 중앙 protocol 확인 → 소유자/사이트 검증 → 세션·일촌평 migration → 함수 → 준비 상태 확인. Pages는 별도 배포. 변경 없음.');return;}
 const lockPath=join(target,'.minihompy-relationships.lock'),lock=await open(lockPath,'wx',0o600);
 try{
  const health=await request(c.centralApiUrl+'/health',{},fetcher);
  if(health.relationship_protocol!==1)throw Error('중앙 관계 protocol 1을 먼저 배포하세요.');
  // Reuse verified owner/site binding and session foundation. Deploy only once,
  // after both migrations; do not enable the public config until all probes pass.
  return await upgradeMemberWriting({...options,target,deploy:async(config,token,root)=>{
   await applyFriendReviews({target:root,query:sql=>request(`https://api.supabase.com/v1/projects/${c.projectRef}/database/query`,{method:'POST',token,body:{query:sql}},fetcher)});
   await deploy(config,token,root);
   const response=await fetcher(c.supabaseUrl+'/functions/v1/member-writing/relationships/health',{headers:{'X-Minihompy-Auth-Mode':'public'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('배포된 관계 health 요청 실패');
   const ready=await response.json();
   if(ready.relationship_protocol!==1||ready.relationship_relay_ready!==true||ready.friend_reviews_ready!==true)throw Error('배포된 관계/일촌평 준비 상태 확인 실패');
  }});
 }finally{await lock.close();await unlink(lockPath);}
}
