import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {PGlite} from '../../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js';
import {memberWritingDb} from './helpers/member-writing-db.mjs';
import {seed,activate,site,owner,post} from './helpers/friend-visibility-fixture.mjs';
import {browserBackend,sqlTransport} from './helpers/home-browser-db.mjs';
import {handleMemberWriting} from '../supabase/functions/member-writing/handler.js';
import {handlePhotoMedia} from '../supabase/functions/photo-media/handler.js';
import {digest} from '../supabase/functions/photo-media/io.js';
import {disableFriendVisibility} from '../setup/friend-visibility-setup.mjs';
const centralUrl='https://central.test/api',h=await memberWritingDb(PGlite,{siteId:site,centralUrl,photoMedia:true,friendVisibility:true});
const out=process.env.VERIFICATION_DIR||'docs/verification/friend-visibility-step12/recovery';await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const ref=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const legacy=Object.fromEntries(['views/photos.js','photos-repository.js'].map(f=>[f,execFileSync('git',['show',ref+':'+f],{encoding:'utf8'})]));
await writeFile(out+'/legacy-source.json',JSON.stringify({commit:ref,files:Object.keys(legacy)},null,2)+'\n');
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
try{
 await seed(h.pg);await activate(h.pg);await h.pg.exec("update storage.buckets set public=false where id='minihompy-photos'");
 await h.pg.query('update private.photo_assets set size=$1,mime=$2,sha256=$3',[png.length,'image/png',await digest(png)]);
 const before=(await h.pg.query('select * from public.photo_posts order by id')).rows,assets=(await h.pg.query('select * from private.photo_assets order by path')).rows;
 const query=async sql=>(await h.pg.exec(sql)).at(-1)?.rows||[];
 const config={MINIHOMPY_SITE_ORIGIN:'https://compat.test',MINIHOMPY_SITE_ID:site,MINIHOMPY_CENTRAL_API_URL:centralUrl,SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',MINIHOMPY_PUBLIC_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 for(const [name,oldUi,oldServer,disabled] of [['old-ui-new-server',true,false,false],['new-ui-old-server',false,true,true],['new-ui-disabled-server',false,false,true]]){
  if(disabled)await disableFriendVisibility({query,siteId:site,centralApiUrl:centralUrl});
  const transport=sqlTransport(h.pg,{owner}),page=await browser.newPage({viewport:{width:375,height:820}}),errors=[],storageRequests=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const files=['member-writing-client.js','content-access.js','post-routes.js','post-location-repository.js','photo-media-client.js','photos-repository.js','comments-repository.js','comments.js','views/photos.js'];
  const boot=browserBackend+`window.fixtureIds={owner:${JSON.stringify(owner)}};window.MINIHOMPY_VIEWS={};window.MINIHOMPY_SUPABASE={url:${JSON.stringify(config.SUPABASE_URL)},publishableKey:'fixture'};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:false};window.MINIHOMPY_MEMBER_WRITING_CONFIG={enabled:false};MinihompyBackend.getClient().storage={from:bucket=>({getPublicUrl:path=>({data:{publicUrl:MINIHOMPY_SUPABASE.url+'/storage/v1/object/public/'+bucket+'/'+path}})})};`;
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/fixture-db')return route.fulfill({json:await transport.handle(req.postDataJSON())});
   if(req.url().startsWith(config.SUPABASE_URL)){
    if(url.pathname.startsWith('/storage/')){storageRequests.push(url.pathname);const rows=await transport.run(()=>h.pg.query("select public from storage.buckets where id='minihompy-photos'"));assert.ok(!rows.rows[0]?.public);return route.fulfill({status:404,body:'private bucket'});}
    if(oldServer&&url.pathname.includes('/content/'))return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
    const request=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})});
    const response=url.pathname.includes('/photo-media/')?await handlePhotoMedia(request,{env:config,rpc:(action,args)=>transport.run(async()=>(await h.pg.query('select public.photo_media($1,$2) r',[action,args])).rows[0].r),storage:{get:async()=>png.slice()}}):await transport.run(()=>handleMemberWriting(request,{config,db:h.db}));
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   }
   const file=url.pathname.slice(1);
   if(files.includes(file))return route.fulfill({contentType:'text/javascript',body:oldUi&&legacy[file]||await readFile(file,'utf8')});
   const setup=`const memberClient=createMinihompyMemberWriting({apiUrl:MINIHOMPY_SUPABASE.url+'/functions/v1/member-writing',siteId:${JSON.stringify(site)},storage:sessionStorage});MinihompyMemberWriting={enabled:()=>false,snapshot:()=>null,check(){},read:(...args)=>memberClient.read(...args)};document.querySelector('#left').append(MINIHOMPY_VIEWS.photos.createLeft());document.querySelector('#main').append(MINIHOMPY_VIEWS.photos.createMain());`;
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="left"></div><div id="main"></div><script>'+boot+'</script>'+files.map(f=>'<script src="/'+f+'"></script>').join('')+'<script>'+setup+'</script>'});
  });
  await page.goto('https://compat.test/');await page.locator('.photo-post').first().waitFor().catch(async e=>{console.log(name,await page.locator('body').innerText(),errors);throw e;});assert.deepEqual(await page.locator('.photo-post').evaluateAll(es=>es.map(e=>e.dataset.post)),[post('photos',0)]);
  assert.equal(await page.locator('[data-post="'+post('photos',1)+'"]').count(),0);
  if(!oldUi)await page.waitForFunction(()=>document.querySelector('.photo-image')?.naturalWidth>0);
  if(oldUi){await page.waitForTimeout(50);assert.ok(storageRequests.length);}
  await page.screenshot({path:out+'/'+name+'.png'});assert.deepEqual(errors,[]);await page.close();
  console.log('PASS: '+name+' serves no friends metadata/images; '+(oldUi?'archived public-file UI fails closed on private Storage':'new UI uses only permitted public fallback'));
 }
 assert.deepEqual((await h.pg.query('select * from public.photo_posts order by id')).rows,before);assert.deepEqual((await h.pg.query('select * from private.photo_assets order by path')).rows,assets);
 await h.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await assert.rejects(h.pg.query("update public.photo_posts set title='must fail' where id=$1",[post('photos',1)]),/NOT_CONFIGURED/);
 for(const role of ['anon','authenticated']){
  await h.pg.exec('set role '+role);await h.pg.query("select set_config('request.jwt.claim.sub','',false)");
  for(const kind of ['board_posts','photo_posts','diary_entries'])assert.equal((await h.pg.query("select * from public."+kind+" where visibility<>'public'")).rows.length,0);
  await assert.rejects(h.pg.query('select * from private.friend_visibility_deployment'),e=>e.code==='42501');await h.pg.exec('reset role');
 }
 const comments=(await h.pg.query("select public.member_comments('list',$1) r",[{site_id:site,mode:'public',kind:'photos',parent_id:post('photos',1),page:1,size:20}])).rows[0].r;assert.equal(comments.failure,'NOT_FOUND');
 console.log('PASS: disable preserves existing friends rows/assets exactly, blocks new friends writes and legacy comment/SQL bypass; protected DB/functions are retained');
}finally{await browser.close();await h.pg.close();}
