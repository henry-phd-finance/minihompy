import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {pgcrypto} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import {applyFriendVisibility,deployFriendVisibility} from '../../minihompy-central/scripts/deploy-friend-visibility.mjs';
const pg=new PGlite({extensions:{pgcrypto}});let failDeploy=true,healthy=false,requests=0,deploys=0;
const query=async sql=>{try{return (await pg.exec(sql)).at(-1)?.rows||[];}catch(e){await pg.exec('rollback');throw e;}};
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of (await readdir('../minihompy-central/supabase/migrations')).sort().filter(n=>n.endsWith('.sql')&&n<'202609240002'))await pg.exec(await readFile('../minihompy-central/supabase/migrations/'+file,'utf8'));
 await pg.exec("insert into private.identity_members(handle,display_name) values('existing','preserved')");const before=await query('select * from private.identity_members');
 const fetcher=async(url,options)=>{requests++;if(url.endsWith('/database/query'))return Response.json(await query(JSON.parse(options.body).query));if(url.endsWith('/health'))return Response.json({friend_visibility_protocol:healthy?1:0,relationship_protocol:1,member_session_protocol:2});throw Error('Unexpected network or secrets endpoint');};
 const runner=(_cmd,args)=>{assert.ok(['identity-api','identity-page'].includes(args[2]));deploys++;const child=new EventEmitter();queueMicrotask(()=>child.emit('close',failDeploy?1:0));return child;};
 const opts={env:{CENTRAL_PROJECT_REF:'a'.repeat(20),SUPABASE_ACCESS_TOKEN:'fixture'},fetcher,runner};
 await deployFriendVisibility(opts);assert.equal(requests,0);assert.equal(deploys,0);
 await assert.rejects(deployFriendVisibility({...opts,apply:true}),/deploy failed/);failDeploy=false;await assert.rejects(deployFriendVisibility({...opts,apply:true}),/capability/);healthy=true;
 for(let i=0;i<2;i++)await deployFriendVisibility({...opts,apply:true});assert.deepEqual(await query('select * from private.identity_members'),before);assert.equal((await query('select * from private.member_writing_deployments')).length,1);
 console.log('PASS 1: central tracked migration, offline dry-run, failed deploy/probe retry, existing identities and signing secrets preserved');
 await pg.exec("update private.member_writing_deployments set sha256='bad'");await assert.rejects(applyFriendVisibility({query}),/hash/);
 await pg.exec('delete from private.member_writing_deployments');await assert.rejects(applyFriendVisibility({query}),/Untracked/);
 for(const role of ['anon','authenticated','service_role']){await pg.exec('set role '+role);await assert.rejects(pg.query('select * from private.member_writing_deployments'),e=>e.code==='42501');await pg.exec('reset role');}
 console.log('PASS 2: central ledger/hash drift and untracked schema rejected; no browser/service write access to installer history');
}finally{await pg.close();}
