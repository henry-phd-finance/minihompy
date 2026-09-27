import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve('../minihompy-central');
const {PGlite}=await import(pathToFileURL(root+'/node_modules/@electric-sql/pglite/dist/index.js'));
const {pgcrypto}=await import(pathToFileURL(root+'/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js'));
const {applyMemberSessions}=await import(pathToFileURL(root+'/scripts/deploy-member-sessions.mjs'));
const pg=new PGlite({extensions:{pgcrypto}});
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of ['202609180001_identity.sql','202609190001_fix_private_schema_permissions.sql','202609230001_verified_identity.sql','202609230002_member_writing.sql','202609230003_member_navigation.sql'])await pg.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
 await pg.exec("insert into private.identity_members(id,handle,display_name) values('10000000-0000-4000-8000-000000000001','fixture','keep')");
 const before=(await pg.query('select * from private.identity_members')).rows;
 const query=async sql=>(await pg.exec(sql)).at(-1)?.rows||[];
 await applyMemberSessions({query});await applyMemberSessions({query});
 assert.deepEqual((await pg.query('select * from private.identity_members')).rows,before);
 assert.equal((await pg.query('select * from private.member_writing_deployments')).rows.length,1);
 await pg.exec("update private.member_writing_deployments set sha256='invalid'");await assert.rejects(applyMemberSessions({query}),/hash differs/);
 await pg.exec('delete from private.member_writing_deployments');await assert.rejects(applyMemberSessions({query}),/Untracked/);
 console.log('PASS: central v1 → v2 tracked migration, idempotent retry, existing member preservation, hash/untracked-schema rejection');
}finally{await pg.close();}
