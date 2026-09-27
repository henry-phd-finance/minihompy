import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
const id=n=>'71000000-0000-4000-8000-'+String(n).padStart(12,'0');
const site=id(100),fixture=await memberWritingDb(PGlite,{siteId:site,centralUrl:'https://central.test/api'});
try{
 for(const file of ['202609240006_friend_reviews.sql','202609270003_friend_review_history.sql'])await fixture.pg.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 for(let author=1;author<=7;author++)for(let entry=1;entry<=3;entry++)await fixture.pg.query('insert into private.friend_reviews(id,site_id,author_member_id,display_name,body,created_at) values($1,$2,$3,$4,$5,$6)',[id(author*10+entry),site,id(author),'same name','entry '+entry,'2026-09-27T00:00:00Z']);
 await fixture.pg.query("insert into private.friend_reviews(site_id,author_member_id,display_name,body) values($1,$2,'other site','must not leak')",[id(101),id(1)]);
 async function list(action='list',extra={}){const {data,error}=await fixture.db.rpc('member_friend_reviews',{p_action:action,p_args:{site_id:site,mode:'public',limit:3,peer_hash:'a'.repeat(64),...extra}});assert.equal(error,null);assert.ok(!data.failure);return data.items;}
 const seen=[],authors=new Set();let cursor={};
 for(;;){const rows=await list('list',cursor),page=rows.slice(0,3);for(const item of page){assert.equal(item.body,'entry 3');assert.ok(!authors.has(item.author_member_id));authors.add(item.author_member_id);seen.push(item);}if(rows.length<=3)break;const last=page.at(-1);cursor={before_time:last.created_at,before_id:last.id};}
 assert.equal(seen.length,7,'summary pages must count authors, even with identical names and timestamps');
 const history=await list('history',{author_member_id:id(1)});assert.deepEqual(history.map(x=>x.body),['entry 3','entry 2','entry 1']);
 assert.deepEqual(await list('history',{author_member_id:id(99)}),[]);
 await fixture.pg.query('delete from private.friend_reviews where id=$1',[id(13)]);
 const summary=await list('list',{limit:50});assert.equal(summary.find(x=>x.author_member_id===id(1)).body,'entry 2');
 assert.equal((await fixture.pg.query('select count(*)::int as n from private.friend_reviews')).rows[0].n,21,'history is preserved; only explicitly deleted review disappears');
 console.log('PASS: latest-per-member before pagination, same-time ID ties, same-name members distinct, author/site isolation, preserved history and deletion fallback.');
}finally{await fixture.pg.close();}
