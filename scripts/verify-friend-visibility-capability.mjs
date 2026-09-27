import assert from 'node:assert/strict';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {handleMemberWriting} from '../supabase/functions/member-writing/handler.js';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
const site='80000000-0000-4000-8000-000000000099',url='https://'+'a'.repeat(20)+'.supabase.co';
const env={SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'fixture',MINIHOMPY_SITE_ID:site,MINIHOMPY_SITE_ORIGIN:'https://a.test',MINIHOMPY_CENTRAL_API_URL:'https://central.test/api',MINIHOMPY_PUBLIC_KEY:'fixture'};
const h=await memberWritingDb(PGlite,{siteId:site,centralUrl:env.MINIHOMPY_CENTRAL_API_URL,friendVisibility:true,photoMedia:true});
const req=(path,extra={})=>new Request(url+'/functions/v1/'+path,{headers:{Origin:env.MINIHOMPY_SITE_ORIGIN,'X-Minihompy-Auth-Mode':'public',...extra}});
try{
 const r=await handleMemberWriting(req('member-writing/content/health'),{config:env,db:h.db});assert.equal(r.status,200);const health=await r.json();assert.equal(health.friend_visibility_setup_protocol,1);assert.equal(health.friend_visibility_ready,false);assert.ok(!JSON.stringify(health).includes('fixture'));
 const p=await handlePhotoMedia(req('photo-media/health'),{env});assert.equal(p.status,200);assert.equal(p.headers.get('Access-Control-Allow-Origin'),env.MINIHOMPY_SITE_ORIGIN);assert.match(p.headers.get('Cache-Control'),/no-store/);const photo=await p.json();assert.equal(photo.friend_media_protocol,1);assert.equal(photo.site_id,site);assert.equal(photo.central_api_url,env.MINIHOMPY_CENTRAL_API_URL);assert.equal(photo.project_url,url);assert.ok(!JSON.stringify(photo).includes('fixture'));
 assert.equal((await handlePhotoMedia(req('photo-media/health',{Origin:'https://wrong.test'}),{env})).status,403);
 assert.equal((await handlePhotoMedia(req('photo-media/health',{Authorization:'Bearer unexpected'}),{env})).status,400);
 assert.equal((await handlePhotoMedia(req('photo-media/health'),{env:{...env,MINIHOMPY_SITE_ID:null}})).status,503);
 assert.equal((await handleMemberWriting(req('member-writing/content/health'),{config:{...env,MINIHOMPY_SITE_ID:'80000000-0000-4000-8000-000000000098'},db:h.db})).status,503);
 console.log('PASS: actual content/photo capability handlers, installed-but-disabled state, project/site binding, CORS/no-store and no credential disclosure');
}finally{await h.pg.close();}
