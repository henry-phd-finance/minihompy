// Cleanup is limited to the UUID and exact body journaled by this live test.
import assert from 'node:assert/strict';
import {readFile,unlink} from 'node:fs/promises';
import {request} from '../setup/identity-setup.mjs';
export async function cleanupNavigationLive({journal,managementToken,projectRef='zcaodcujqbjrogffwalk'}){
 let data;try{data=JSON.parse(await readFile(journal,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
 assert.match(projectRef,/^[a-z]{20}$/);assert.match(data.id,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);assert.equal(data.body,'이동 검증 '+data.id);
 if(!managementToken)throw Error('Cleanup management token required');
 const query=sql=>request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`,{method:'POST',token:managementToken,body:{query:sql}});
 const rows=await query(`select id,body from public.guestbook_posts where id='${data.id}'`);
 if(rows.length){assert.equal(rows[0].body,data.body);await query(`delete from public.guestbook_posts where id='${data.id}' and body='${data.body}'`);}
 assert.equal((await query(`select id from public.guestbook_posts where id='${data.id}'`)).length,0);await unlink(journal);
}
