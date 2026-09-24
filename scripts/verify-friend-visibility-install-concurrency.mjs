import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import pg from '../../minihompy-central/node_modules/pg/lib/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {seed,activate,site,owner,post,centralOwner} from './helpers/friend-visibility-fixture.mjs';
import {disableFriendVisibility,activateFriendVisibility} from '../setup/friend-visibility-setup.mjs';
const container=execFileSync('docker',['run','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:16-alpine'],{encoding:'utf8'}).trim();
let pool,fixture,a,b;const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const port=Number(execFileSync('docker',['port',container,'5432'],{encoding:'utf8'}).trim().split(':').at(-1)),cfg={host:'127.0.0.1',port,user:'postgres',database:'postgres'};
 pool=new pg.Pool(cfg);for(let i=0;;i++){try{await pool.query('select 1');break;}catch(e){if(i>100)throw e;await pause(100);}}
 class Adapter{constructor(){this.client=new pg.Client(cfg);this.ready=this.client.connect();}async query(s,args){await this.ready;return this.client.query(s,args);}exec(s){return this.query(s);}close(){return this.client.end();}}
 fixture=await memberWritingDb(Adapter,{siteId:site,centralUrl:'https://central.test/api',photoMedia:true,friendVisibility:true});await seed(pool);await activate(pool);await pool.query("update storage.buckets set public=false where id='minihompy-photos'");
 a=await pool.connect();b=await pool.connect();const query=client=>async sql=>{try{const r=await client.query(sql);return (Array.isArray(r)?r.at(-1):r).rows;}catch(e){await client.query('rollback');throw e;}};
 const options={siteId:site,centralApiUrl:'https://central.test/api'},before=(await pool.query('select * from public.board_posts order by id')).rows;
 const old=await disableFriendVisibility({query:query(a),...options});
 await a.query('begin');await a.query('update private.friend_visibility_deployment set epoch=gen_random_uuid()');
 const pending=activateFriendVisibility({query:query(b),...options,ownerId:centralOwner,epoch:old,pagesHash:'a'.repeat(64)}).then(()=>null,e=>e);
 for(let i=0;;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[b.processID])).rows[0]?.wait_event_type==='Lock')break;if(i>200)throw Error('Expected lock');await pause(10);}
 await a.query('commit');assert.match((await pending).message,/fence/);assert.equal((await pool.query('select ready from private.friend_visibility_state')).rows[0].ready,false);
 const current=await disableFriendVisibility({query:query(a),...options});await activateFriendVisibility({query:query(b),...options,ownerId:centralOwner,epoch:current,pagesHash:'b'.repeat(64)});assert.equal((await pool.query('select ready from private.friend_visibility_state')).rows[0].ready,true);
 assert.deepEqual((await pool.query('select * from public.board_posts order by id')).rows,before);
 console.log('PASS 1: independent connections block stale activation behind epoch replacement, then refuse it; fresh activation preserves all content');
 await a.query('begin');await a.query('update private.friend_visibility_state set ready=false');await b.query('set role authenticated');await b.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 const write=b.query("update public.board_posts set title='blocked' where id=$1",[post('board',1)]).then(()=>null,e=>e);
 for(let i=0;;i++){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[b.processID])).rows[0]?.wait_event_type==='Lock')break;if(i>200)throw Error('Expected lock');await pause(10);}
 await a.query('commit');assert.match((await write).message,/NOT_CONFIGURED/);assert.deepEqual((await pool.query('select * from public.board_posts order by id')).rows,before);
 console.log('PASS 2: committed disable beats an already-waiting friends edit; no partial write or public reclassification');
}finally{for(const c of [a,b])if(c){await c.query('rollback').catch(()=>{});c.release();}if(fixture)await fixture.pg.close();if(pool)await pool.end();execFileSync('docker',['rm','-f',container],{stdio:'ignore'});}
