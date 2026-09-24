import {handleMemberWriting} from '../supabase/functions/member-writing/handler.js';
import assert from 'node:assert/strict';import {mkdtemp,cp,readFile,writeFile,rm,access,unlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {upgradeMemberRelationships,applyFriendReviews,relationshipMigration} from '../setup/member-relationship-setup.mjs';
import {memberWritingDb} from './helpers/member-writing-db.mjs';import {applyWritingMigrations,upgradeMemberWriting,writingMigrations} from '../setup/member-writing-setup.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2]||'../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js')));
const root=await mkdtemp(join(tmpdir(),'writing-setup-'));const db=await memberWritingDb(PGlite,{writing:false});
const owner='10000000-0000-4000-8000-000000000001',site='20000000-0000-4000-8000-000000000001';
const config={githubUser:'alice',githubRepo:'minihompy',projectRef:'a'.repeat(20),publishableKey:'sb_publishable_testpublickey',handle:'alice',displayName:'Alice',centralApiUrl:'https://central.test/api',centralPageUrl:'https://central.test/hub',siteId:site};
let deploys=0,offline=false,legacyCentral=false;const query=async sql=>(await db.pg.query(sql)).rows;
try{
 await cp(new URL('../supabase',import.meta.url),join(root,'supabase'),{recursive:true});await cp(new URL('../login',import.meta.url),join(root,'login'),{recursive:true});for(const file of ['index.html','member-writing-runtime.js','member-writing-client.js','member-relationships-repository.js','member-relationships.js','member-relationship-lists.js','friend-reviews-repository.js','friend-reviews.js'])await cp(new URL('../'+file,import.meta.url),join(root,file));await writeFile(join(root,'member-writing-config.js'),'disabled');
 await db.pg.query('insert into auth.users values($1)',[owner]);await db.pg.query('insert into private.minihompy_admins values($1)',[owner]);await db.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 const post=(await db.pg.query("insert into public.guestbook_posts(id,author_name,body,visibility) values(gen_random_uuid(),'old','preserve','private') returning *")).rows[0];
 const sql=async text=>{const results=await db.pg.exec(text);return results.at(-1)?.rows||[];};
 const fetcher=async(url,options={})=>{
  if(url.endsWith('/relationships/health'))return handleMemberWriting(new Request(url,options),{db:db.db,config:{MINIHOMPY_SITE_ORIGIN:'https://alice.github.io',MINIHOMPY_SITE_ID:site,MINIHOMPY_CENTRAL_API_URL:config.centralApiUrl,SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',MINIHOMPY_PUBLIC_KEY:config.publishableKey},fetcher:async()=>Response.json({relationship_protocol:offline?0:1})});
  if(url.endsWith('/health'))return Response.json({writing_protocol:1,member_session_protocol:2,...(!legacyCentral?{relationship_protocol:1}:{})});
  if(url.includes('/auth/v1/token'))return Response.json({access_token:'test-owner-token'});
  if(url.endsWith('/is_minihompy_admin'))return Response.json(true);
  if(url.endsWith('/login-intents'))return Response.json({login_intent:'intent',login_url:'https://alice.github.io/minihompy/?login_intent='});
  if(url.endsWith('/activation-tickets')){assert.ok(!options.body.includes('password'));return Response.json({activation_ticket:'proof'});}
  if(url.endsWith('/database/query'))return Response.json(await sql(JSON.parse(options.body).query));
  if(url.endsWith('/secrets')){assert.ok(!options.body.includes('CENTRAL_TOKEN_SECRET'));return Response.json({});}
  if(url.endsWith('/sessions/renew'))return Response.json({error:{code:'SESSION_EXPIRED'}},{status:401});
  if(url.endsWith('/sessions/current'))return Response.json({actor:{kind:'owner'}},{status:offline?503:200});
  if(url.includes('/logout'))return Response.json({});
  throw Error('Unexpected fixture endpoint');
 };
 const opts={config,target:root,email:'private@example.test',password:'private',managementToken:'private-management',fetcher,deploy:async()=>{deploys++;},log:()=>{}};
 await upgradeMemberRelationships({...opts,dryRun:true});assert.equal(deploys,0);assert.equal(await readFile(join(root,'member-writing-config.js'),'utf8'),'disabled');
 await writeFile(join(root,'.minihompy-relationships.lock'),'');await assert.rejects(upgradeMemberRelationships(opts),/EEXIST/);await unlink(join(root,'.minihompy-relationships.lock'));
 legacyCentral=true;await assert.rejects(upgradeMemberRelationships(opts));assert.equal(deploys,0);legacyCentral=false;
 offline=true;await assert.rejects(upgradeMemberRelationships(opts));assert.equal(await readFile(join(root,'member-writing-config.js'),'utf8'),'disabled');
 await assert.rejects(access(join(root,'.minihompy-relationships.lock')),/ENOENT/);
 const current=(await query('select * from public.guestbook_posts')).at(0);for(const [key,value] of Object.entries(post))assert.deepEqual(current[key],value);
 offline=false;await upgradeMemberRelationships(opts);assert.match(await readFile(join(root,'member-writing-config.js'),'utf8'),/enabled: true/);
 await upgradeMemberRelationships(opts);assert.equal((await query('select * from private.minihompy_setup_migrations')).length,6);
 await db.pg.query("insert into private.friend_reviews(site_id,author_member_id,display_name,body) values($1,$2,'old','preserve review')",[site,owner]);
 await upgradeMemberRelationships(opts);assert.equal((await query('select body from private.friend_reviews'))[0].body,'preserve review');
 const reviewHash=(await query("select sha256 from private.minihompy_setup_migrations where name='"+relationshipMigration+"'"))[0].sha256;
 await db.pg.query("update private.minihompy_setup_migrations set sha256='bad' where name=$1",[relationshipMigration]);await assert.rejects(applyFriendReviews({target:root,query:sql}),/해시/);await db.pg.query('update private.minihompy_setup_migrations set sha256=$1 where name=$2',[reviewHash,relationshipMigration]);
 await db.pg.query("update private.minihompy_setup_migrations set sha256='wrong' where name=$1",[writingMigrations[0]]);await assert.rejects(applyWritingMigrations({target:root,query:sql}),/해시/);
 await db.pg.query('delete from private.minihompy_setup_migrations');await assert.rejects(applyWritingMigrations({target:root,query:sql}),/추적되지/);
 await assert.rejects(applyFriendReviews({target:root,query:sql}),/추적되지/);
 console.log('PASS: relationship upgrade preserves legacy rows and reviews, tracked migrations retry without replay, failed probe never enables UI, owner binding proof, no central secret, hash/untracked fail-stop, dry-run.');
}finally{await db.pg.close();await rm(root,{recursive:true,force:true});}
