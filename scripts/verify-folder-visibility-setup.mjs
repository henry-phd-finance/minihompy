import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {upgradeFolderVisibility,folderVisibilityMigrations,applyFolderVisibilityMigrations} from '../setup/folder-visibility-setup.mjs';
const target=await mkdtemp(join(tmpdir(),'visibility-setup-'));
const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_testpublickey',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub'};
let pg,requests=0,deploys=0,admin=true,badProbe=false,failDeploy=false;const secrets=[],logs=[];
const query=async sql=>(await pg.exec(sql)).at(-1)?.rows||[];
const fetcher=async(url,init={})=>{
 requests++;
 if(url.includes('/auth/v1/token'))return Response.json({access_token:'fixture'});
 if(url.endsWith('/is_minihompy_admin'))return Response.json(admin);
 if(url.endsWith('/database/query'))return Response.json(await query(JSON.parse(init.body).query));
 if(url.endsWith('/secrets')){secrets.push(...JSON.parse(init.body));return Response.json({});}
 if(url.endsWith('/photo-media/read'))return Response.json({error:{code:'NOT_FOUND'}},{status:badProbe?500:404,headers:{'access-control-allow-origin':'https://alice.github.io','cache-control':'private, no-store'}});
 if(url.includes('/logout'))return Response.json({});throw Error('Unexpected request '+url);
};
try{
 for(const name of ['supabase','index.html','content-access.js','content-folders-repository.js','content-folders.js','photo-media-client.js','photos-repository.js','photo-editor.js'])await cp(new URL('../'+name,import.meta.url),join(target,name),{recursive:true});
 await writeFile(join(target,'supabase-config.js'),'window.MINIHOMPY_SUPABASE={url:"https://'+'a'.repeat(20)+'.supabase.co"}');
 const opts={config,target,email:'owner@test',password:'fixture-private',managementToken:'fixture-token',fetcher,deploy:async()=>{deploys++;if(failDeploy)throw Error('deploy unavailable');},log:s=>logs.push(s)};
 await upgradeFolderVisibility({...opts,dryRun:true});assert.equal(requests,0);assert.equal(deploys,0);
 for(const existing of [false,true]){
  ({pg}=await memberWritingDb(PGlite,{siteId:'90000000-0000-4000-8000-000000000099',centralUrl:'https://central.test/api',folders:false,photoMedia:false}));
  if(existing)await pg.exec("insert into public.board_posts(folder_id,author_name,title,body) select id,'old owner','preserved','body' from public.board_folders;select public.visit_record((now() at time zone 'Asia/Seoul')::date,repeat('a',64));");
  const before=(await query('select id,folder_id,author_name,title,body,created_at from public.board_posts'));
  admin=false;await assert.rejects(upgradeFolderVisibility(opts),/관리자/);admin=true;
  failDeploy=true;await assert.rejects(upgradeFolderVisibility(opts),/deploy unavailable/);failDeploy=false;
  assert.equal((await query('select ready from private.photo_media_state'))[0].ready,false);
  badProbe=true;await assert.rejects(upgradeFolderVisibility(opts),/준비 확인/);badProbe=false;
  for(let i=0;i<2;i++)assert.deepEqual(await upgradeFolderVisibility(opts),{prepared:true,mediaMode:'legacy',mediaReady:false});
  assert.equal((await query('select * from private.minihompy_setup_migrations')).length,5);
  assert.deepEqual(await query('select id,folder_id,author_name,title,body,created_at from public.board_posts'),before);
  assert.equal((await query('select public.visit_stats() data'))[0].data.total,existing?1:0);
  assert.ok(secrets.every(s=>['MINIHOMPY_PUBLIC_KEY','MINIHOMPY_SITE_ORIGIN'].includes(s.name)));
  await query("select public.photo_media('freeze');select public.photo_media('protect');update private.photo_media_state set ready=true");
  assert.deepEqual(await upgradeFolderVisibility(opts),{prepared:true,mediaMode:'protected',mediaReady:true});
  const file=join(target,'supabase/migrations',folderVisibilityMigrations[0]),original=await readFile(file,'utf8');
  await writeFile(file,original+'\n-- drift');await assert.rejects(upgradeFolderVisibility(opts),/해시/);await writeFile(file,original);
  await query("delete from private.minihompy_setup_migrations where name='202609240001_content_folders.sql'");
  await assert.rejects(applyFolderVisibilityMigrations({target,query,log:()=>{}}),/추적되지/);
  await pg.close();pg=null;
  console.log('PASS: '+(existing?'populated upgrade':'fresh schema')+' preserves data, tracked retry, deployment/probe failure stays disabled, hash/untracked rejection');
 }
 await writeFile(join(target,'.minihompy-folder-visibility.lock'),'');await assert.rejects(upgradeFolderVisibility(opts),/이미 실행/);await rm(join(target,'.minihompy-folder-visibility.lock'));
 await rm(join(target,'photo-media-client.js'));await assert.rejects(upgradeFolderVisibility({...opts,dryRun:true}),/ENOENT/);
 assert.ok(!logs.join('').includes('fixture-private'));assert.ok(!logs.join('').includes('fixture-token'));
 console.log('PASS: offline dry run, missing runtime, local concurrency lock, no secret logging or automatic ready/Pages activation');
}finally{if(pg)await pg.close();await rm(target,{recursive:true,force:true});}
