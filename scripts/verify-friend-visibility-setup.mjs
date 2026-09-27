import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {upgradeFriendVisibility,applyFriendVisibilityMigrations,friendVisibilityMigrations,disableFriendVisibility,activateFriendVisibility} from '../setup/friend-visibility-setup.mjs';
import {friendPagesRelease,sha256} from '../setup/friend-visibility-release.mjs';
import {runtimeFiles,validateConfig} from '../setup/identity-setup.mjs';
const target=await mkdtemp(join(tmpdir(),'friend-setup-')),id=n=>'80000000-0000-4000-8000-'+String(n).padStart(12,'0');
const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_fixture123456789',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub',siteId:id(99)},c=validateConfig(config);
let pg,requests=0,deployments=0,failDeploy=false,centralReady=true,oldServer=false,badMediaBinding=false,badPages=false,wrongOwner=false,failFinal=false,admin=true,failSql=null;const logs=[];
const query=async sql=>{try{if(failSql&&sql.includes(failSql)){failSql=null;throw Error('interrupted migration');}const rows=await pg.exec(sql);return rows.at(-1)?.rows||[];}catch(e){await pg.exec('rollback');throw e;}};
const fetcher=async(url,init={})=>{
 requests++;
 if(url.startsWith(c.homepage)){
  assert.equal(init.headers?.Authorization,undefined);assert.equal(init.redirect,'error');
  const name=url.slice(c.homepage.length);
  const bytes=name==='friend-visibility-release.json'?Buffer.from(JSON.stringify(await friendPagesRelease(target))):await readFile(join(target,name));
  return new Response(badPages&&name==='views/photos.js'?'old runtime':bytes);
 }
 if(url===c.centralApiUrl+'/health')return Response.json({friend_visibility_protocol:centralReady?1:0,relationship_protocol:1,member_session_protocol:2});
 if(url.endsWith('/login-intents')){assert.match(JSON.parse(init.body).code_challenge,/^[A-Za-z0-9_-]{43}$/);return Response.json({login_url:c.homepage+'login/?login_intent=',login_intent:'fixture'});}
 if(url.endsWith('/activation-tickets')){assert.equal(init.headers.Authorization,'Bearer owner.fixture.jwt');assert.ok(!init.body.includes('fixture-password'));return Response.json({activation_ticket:'fixture.'+Buffer.from(JSON.stringify({kind:'activation_ticket',site_id:c.siteId,sub:wrongOwner?id(2):id(1),exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.fixture'});}
 if(url.includes('/auth/v1/token'))return Response.json({access_token:'owner.fixture.jwt'});
 if(url.endsWith('/is_minihompy_admin'))return Response.json(admin);
 if(url.endsWith('/database/query'))return Response.json(await query(JSON.parse(init.body).query));
 if(url.includes('/logout'))return Response.json({});
 if(url.endsWith('/content/list')){assert.equal(init.headers.Authorization,'Bearer owner.fixture.jwt');assert.equal(init.headers['X-Minihompy-Auth-Mode'],'owner');return Response.json({protocol:1,view:{mode:'owner'},data:{items:[]}});}
 if(url.endsWith('/health')){
  const state=(await query('select * from private.friend_visibility_state'))[0];
  return Response.json(url.endsWith('/photo-media/health')?{friend_media_protocol:1,friend_visibility_setup_protocol:oldServer?0:1,site_id:c.siteId,central_api_url:c.centralApiUrl,project_url:badMediaBinding?'https://wrong.test':c.supabaseUrl}:{friend_visibility_protocol:1,friend_visibility_setup_protocol:oldServer?0:1,friend_visibility_ready:failFinal?false:state.ready,friend_media_ready:state.media_ready,friend_summary_ready:state.summary_ready,friend_pages_ready:state.pages_ready},{headers:{'access-control-allow-origin':c.origin,'cache-control':'private, no-store'}});
 }
 throw Error('Unexpected endpoint (secret writes prohibited): '+url);
};
const opts={config,target,email:'owner@fixture',password:'fixture-password',managementToken:'fixture-management',fetcher,deploy:async()=>{deployments++;if(failDeploy)throw Error('deploy failed');},log:m=>logs.push(m)};
const state=async()=>(await query('select * from private.friend_visibility_state'))[0];
const canFriend=()=>query("update public.board_posts set visibility='friends' where title='preserved'");
try{
 for(const name of ['supabase','index.html','styles.css','assets','views','login'])await cp(new URL('../'+name,import.meta.url),join(target,name),{recursive:true});
 for(const name of await readdir(new URL('../',import.meta.url)))if(name.endsWith('.js'))await cp(new URL('../'+name,import.meta.url),join(target,name));
 for(const [name,content] of Object.entries(runtimeFiles(c,c.siteId)))await writeFile(join(target,name),content);
 await writeFile(join(target,'member-writing-config.js'),'window.MINIHOMPY_MEMBER_WRITING_CONFIG=Object.freeze({enabled:true});');
 for(const phase of ['prepare','activate','disable'])await upgradeFriendVisibility({...opts,phase,dryRun:true});assert.equal(requests,0);assert.equal(deployments,0);
 console.log('PASS 1: all phases dry-run offline; source/runtime checks without file or network mutations');
 ({pg}=await memberWritingDb(PGlite,{siteId:c.siteId,centralUrl:c.centralApiUrl,photoMedia:true,friendVisibility:false}));
 await pg.exec(await readFile('supabase/migrations/202609240006_friend_reviews.sql','utf8'));
 await query(`insert into auth.users values('${id(10)}');insert into private.minihompy_admins values('${id(10)}');select set_config('request.jwt.claim.sub','${id(10)}',false);update private.photo_media_state set mode='protected',ready=true;insert into public.board_posts(folder_id,author_name,title,body) select id,'owner','preserved','body' from public.board_folders limit 1;`);
 const before=await query('select * from public.board_posts'),sessions=await query('select * from private.member_writing_site');
 admin=false;await assert.rejects(upgradeFriendVisibility(opts),/관리자/);admin=true;centralReady=false;await assert.rejects(upgradeFriendVisibility(opts),/중앙/);centralReady=true;
 failSql='create function public.member_photo_read';await assert.rejects(upgradeFriendVisibility(opts),/연결/);assert.equal((await state()).ready,false);await assert.rejects(canFriend(),/NOT_CONFIGURED/);
 failDeploy=true;await assert.rejects(upgradeFriendVisibility(opts),/deploy failed/);failDeploy=false;assert.equal((await state()).ready,false);
 oldServer=true;await assert.rejects(upgradeFriendVisibility(opts),/capability/);oldServer=false;badMediaBinding=true;await assert.rejects(upgradeFriendVisibility(opts),/protocol/);badMediaBinding=false;
 for(let i=0;i<2;i++)assert.deepEqual(await upgradeFriendVisibility(opts),{prepared:true,ready:false});
 assert.equal((await query('select * from private.minihompy_setup_migrations')).length,friendVisibilityMigrations.length);assert.deepEqual(await query('select * from public.board_posts'),before);assert.deepEqual(await query('select * from private.member_writing_site'),sessions);await assert.rejects(canFriend(),/NOT_CONFIGURED/);
 console.log('PASS 2: interrupted SQL/deploy/probe retries, tracked hashes and existing content/site preserved; no partial friends writes');
 await writeFile(join(target,'member-writing-config.js'),'window.MINIHOMPY_MEMBER_WRITING_CONFIG=Object.freeze({enabled:false});');await assert.rejects(upgradeFriendVisibility({...opts,phase:'activate'}),/설정/);await writeFile(join(target,'member-writing-config.js'),'window.MINIHOMPY_MEMBER_WRITING_CONFIG=Object.freeze({enabled:true});');
 badPages=true;await assert.rejects(upgradeFriendVisibility({...opts,phase:'activate'}),/해시/);badPages=false;assert.equal((await state()).ready,false);
 await query('update private.photo_media_state set ready=false');await assert.rejects(upgradeFriendVisibility({...opts,phase:'activate'}),/연결/);await query('update private.photo_media_state set ready=true');
 await assert.rejects(upgradeFriendVisibility({...opts,phase:'activate'}),/연결/);await query("update storage.buckets set public=false where id='minihompy-photos'");
 const active=await upgradeFriendVisibility({...opts,phase:'activate'});assert.equal(active.ready,true);assert.equal((await state()).owner_member_id,id(1));assert.equal((await query('select pages_sha256 from private.friend_visibility_deployment'))[0].pages_sha256,active.pagesHash);
 await canFriend();const protectedRows=await query('select * from public.board_posts');
 console.log('PASS 3: actual Pages file hash mismatch and incomplete media deny activation; complete probes enable tracked release and friends writes');
 wrongOwner=true;await assert.rejects(upgradeFriendVisibility({...opts,phase:'activate'}),/연결/);wrongOwner=false;assert.equal((await state()).ready,false);
 failFinal=true;await assert.rejects(upgradeFriendVisibility({...opts,phase:'activate'}),/최종/);failFinal=false;assert.equal((await state()).ready,false);
 const first=await disableFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl});await disableFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl});await assert.rejects(activateFriendVisibility({query,siteId:c.siteId,centralApiUrl:c.centralApiUrl,ownerId:id(1),epoch:first,pagesHash:active.pagesHash}),/fence/);
 centralReady=false;assert.deepEqual(await upgradeFriendVisibility({...opts,phase:'disable'}),{ready:false});centralReady=true;assert.deepEqual(await query('select * from public.board_posts'),protectedRows);await assert.rejects(canFriend(),/NOT_CONFIGURED/);
 console.log('PASS 4: wrong binding, failed final probe and stale activation epoch fail closed; offline-central disable preserves friends data');
 const file=join(target,'supabase/migrations',friendVisibilityMigrations[0]),original=await readFile(file,'utf8');await writeFile(file,original+'\n-- drift');await assert.rejects(applyFriendVisibilityMigrations({target,query}),/해시/);await writeFile(file,original);
 await query("delete from private.minihompy_setup_migrations where name='202609240012_friend_visibility_deployment.sql'");await assert.rejects(applyFriendVisibilityMigrations({target,query}),/추적되지/);
 await writeFile(join(target,'.minihompy-friend-visibility.lock'),'');await assert.rejects(upgradeFriendVisibility(opts),/이미/);await rm(join(target,'.minihompy-friend-visibility.lock'));
 assert.ok(logs.every(s=>!s.includes('fixture-password')&&!s.includes('fixture-management')&&!s.includes('owner.fixture.jwt')));
 for(const role of ['anon','authenticated','service_role']){await pg.exec('set role '+role);await assert.rejects(pg.query('select * from private.friend_visibility_deployment'),e=>e.code==='42501');await pg.exec('reset role');}
 console.log('PASS 5: hash/schema drift, missing ledger, local concurrent run refused; secrets absent from logs/Pages and no secret rotation');
}finally{if(pg)await pg.close();await rm(target,{recursive:true,force:true});}
