import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handlePhotoMedia} from '../../supabase/functions/photo-media/handler.js';
import {digest,fail,BUCKET} from '../../supabase/functions/photo-media/io.js';
export async function prepareVisibilityFixture(s,fetcher,fileId){
 s.mediaFiles=new Map();s.mediaFetch=fetcher;
 s.mediaRpc=(action,args={})=>s.transport.run(async()=>{
  await s.personal.pg.exec('set role service_role');
  try{const v=(await s.personal.pg.query('select public.photo_media($1,$2) v',[action,args])).rows[0].v;if(v.failure)fail(v.failure);return v;}
  finally{await s.personal.pg.exec('reset role');}
 });
 await s.mediaRpc('freeze');await s.mediaRpc('protect');await s.personal.pg.exec('update private.photo_media_state set ready=true');
 s.mediaPath=s.parents.photos+'/'+fileId+'.jpg';
 const bytes=new Uint8Array(await readFile(new URL('../../assets/photos/lake.jpg',import.meta.url)));
 const args={owner_id:s.owner,path:s.mediaPath,post_id:s.parents.photos,size:bytes.length,mime:'image/jpeg',sha256:await digest(bytes)};
 await s.mediaRpc('reserve',args);s.mediaFiles.set(s.mediaPath,bytes);await s.mediaRpc('complete',args);
}
export function routePhotoMedia(s,req){return handlePhotoMedia(req,{env:{...s.config,SUPABASE_SERVICE_ROLE_KEY:'fixture-service'},fetcher:s.mediaFetch,rpc:s.mediaRpc,storage:{
 async get(bucket,path){assert.equal(bucket,BUCKET);const b=s.mediaFiles.get(path);if(!b)fail('NOT_FOUND');return b.slice();},
 async put(bucket,path,b){assert.equal(bucket,BUCKET);if(s.mediaFiles.has(path))fail('EXISTS');s.mediaFiles.set(path,b.slice());},
 async remove(bucket,paths){assert.equal(bucket,BUCKET);for(const p of paths)s.mediaFiles.delete(p);}
}});}
async function visibility(s,kind,value){return s.transport.run(async()=>{
 const table={board:'board_posts',photos:'photo_posts',diary:'diary_entries'}[kind];
 await s.personal.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[s.owner]);await s.personal.pg.exec('set role authenticated');
 try{await s.personal.pg.query(`update public.${table} set visibility=$1 where id=$2`,[value,s.parents[kind]]);}
 finally{await s.personal.pg.exec('reset role');await s.personal.pg.exec("select set_config('request.jwt.claim.sub','',false)");}
});}
export async function checkOwnerVisibility(page,s,id){
 await page.locator('[data-menu=board]').dispatchEvent('click');
 await page.locator('.board-folder-manage').click();const dialog=page.locator('.folder-manager');
 await dialog.getByRole('button',{name:'폴더 만들기',exact:true}).click();await dialog.getByLabel('이름',{exact:true}).fill('A destination');await dialog.getByRole('button',{name:'저장',exact:true}).click();
 await dialog.getByText('A destination',{exact:true}).waitFor();await dialog.getByRole('button',{name:'닫기',exact:true}).click();
 const source=(await s.personal.pg.query('select folder_id from board_posts where id=$1',[s.parents.board])).rows[0].folder_id;
 const dest=(await s.personal.pg.query("select id from board_folders where label='A destination'")).rows[0].id;
 for(const kind of ['board','photos','diary'])await visibility(s,kind,'private');
 const response=await page.evaluate(async({source,dest,request})=>{
  const c=await MinihompyContentAccess.open(true),snapshot=await c.client.rpc('manage_content_folders',{p_action:'snapshot',p_args:{menu:'board'}});
  return c.client.rpc('manage_content_folders',{p_action:'delete',p_args:{menu:'board',id:source,destination_id:dest,request_id:request,expected_revision:snapshot.data.menu_revision}});
 },{source,dest,request:id(81)});
 assert.equal(response.data.moved_count,1);
 for(const kind of ['board','photos','diary']){
  await page.goto(s.home+'#/'+kind+'?post='+s.parents[kind]);
  await page.locator(`[data-post="${s.parents[kind]}"],[data-entry="${s.parents[kind]}"]`).waitFor();
  if(kind==='photos')await page.waitForFunction(()=>document.querySelector('.photo-image')?.naturalWidth>0);
 }
 const summary=(await s.personal.pg.query('select public.home_summary() v')).rows[0].v;
 for(const kind of ['board','photos','diary'])assert.equal(summary.counts[kind].total,0);
 const moved=(await s.personal.pg.query('select folder_id,visibility from board_posts where id=$1',[s.parents.board])).rows[0];assert.equal(moved.folder_id,dest);assert.equal(moved.visibility,'private');
 await page.locator('[data-menu=home]').dispatchEvent('click');
 console.log('PASS: A owner creates folder, moves private post without disclosure, reads private direct addresses/images; home stays public-only');
}
export async function checkVisitorVisibility(page,sites,id,context,routeHandler){
 const b=sites[1];for(const kind of ['board','photos','diary'])await visibility(b,kind,'private');
 for(const kind of ['board','photos','diary']){
  await page.goto(b.home+'#/'+kind+'?post='+b.parents[kind]);await page.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-comment]').count(),0);assert.equal(await page.locator('.photo-image').count(),0);
 }
 assert.equal(await page.locator('.diary-day.written').count(),0);
 const anonymous=await context.browser().newContext();await anonymous.route('**/*',routeHandler);
 const visitor=await anonymous.newPage();
 for(const site of sites){await visitor.goto(site.home+'#/photos?post='+site.parents.photos);await visitor.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).waitFor();assert.equal(await visitor.locator('.photo-image').count(),0);}
 await anonymous.close();
 const readReq=token=>new Request(b.config.SUPABASE_URL+'/functions/v1/photo-media/read',{method:'POST',headers:{Origin:b.origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({post_id:b.parents.photos,path:b.mediaPath})});
 assert.equal((await routePhotoMedia(b,readReq())).status,404);
 // A's personal JWT is not a B admin even when both central identity and A login persist.
 assert.equal((await routePhotoMedia(b,readReq('header.alice.signature'))).status,401);
 const summary=(await b.personal.pg.query('select public.home_summary() v')).rows[0].v;
 for(const kind of ['board','photos','diary'])assert.equal(summary.counts[kind].total,0);
 const peer=await context.newPage();await peer.goto(b.home+'#/photos?post='+b.parents.photos);await peer.getByText('글이 삭제되었거나 조회할 수 없습니다.',{exact:false}).waitFor();await peer.close();
 assert.equal((await b.personal.pg.query('select count(*)::int n from post_comments where author_member_id=$1',[sites[0].member])).rows[0].n,4);
 for(const kind of ['board','photos','diary'])await visibility(b,kind,'public');
 await page.goto(b.home+'#/photos?post='+b.parents.photos);await page.waitForFunction(()=>document.querySelector('.photo-image')?.naturalWidth>0);await page.locator('[data-comment]').first().waitFor();
 console.log('PASS: A on B loses private posts/comments/images/direct addresses across tabs; foreign JWT denied, public restoration preserves comments');
}
