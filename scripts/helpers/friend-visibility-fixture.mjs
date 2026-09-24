import {createHash,randomUUID} from 'node:crypto';
export const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const site=id(99),owner=id(1),visitor=id(2),actor=id(10),centralOwner=id(11),centralSession=id(12),tokenHash='a'.repeat(64);
export const tables={board:'board_posts',photos:'photo_posts',diary:'diary_entries'};
export const post=(kind,n)=>id(({board:100,photos:200,diary:300})[kind]+n);
export const photoPath=n=>post('photos',n)+'/'+id(999)+'.png';
export const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export function request(mode='member',action='list',selectors={kind:'board',page:1,size:20},extra={}){
 const args={site_id:site,mode,scope:mode==='public'?'public':'visible',selectors,...extra};
 if(mode==='owner')args.owner_id=owner;
 if(mode==='member'){
  const start=Date.now();Object.assign(args,{token_hash:tokenHash,request_id:randomUUID(),read_started_at:new Date(start).toISOString(),deadline:new Date(start+3500).toISOString()});
  args.context={protocol:1,request_id:args.request_id,request_hash:createHash('sha256').update(canonical({protocol:1,mode,scope:args.scope,action:'content.'+action,selectors})).digest('hex'),actor_member_id:actor,site_id:site,owner_member_id:centralOwner,central_session_id:centralSession,relationship:'accepted',relationship_revision:2,can_read_friends:true,authorized_at:new Date(start).toISOString(),expires_at:new Date(start+5000).toISOString()};
 }
 return args;
}
export async function seed(pg){
 await pg.query('insert into auth.users values($1),($2)',[owner,visitor]);await pg.query('insert into private.minihompy_admins values($1)',[owner]);
 await pg.query("update private.photo_media_state set mode='protected',ready=true");
 for(const kind of Object.keys(tables))for(const n of [0,1,2]){
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  const p=post(kind,n),visibility=n===2?'private':'public';
  if(kind==='board')await pg.query("insert into public.board_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','title-'||$3,'body-'||$3,$4 from public.board_folders limit 1",[p,owner,String(n),visibility]);
  if(kind==='diary')await pg.query("insert into public.diary_entries(id,folder_id,author_id,author_name,entry_date,entry_time,body,visibility) select $1,id,$2,'owner',date '2026-09-24'+$3::int,'12:30','diary-'||$3,$4 from public.diary_folders limit 1",[p,owner,n,visibility]);
  if(kind==='photos'){
   await pg.query("insert into private.photo_assets(path,post_id,uploaded_by,complete,size,mime,sha256) values($1,$2,$3,true,1,'image/png',$4)",[photoPath(n),p,owner,'b'.repeat(64)]);
   await pg.query("insert into public.photo_posts(id,folder_id,author_id,author_name,title,body,visibility) select $1,id,$2,'owner','photo-'||$3,$4,$5 from public.photo_folders limit 1",[p,owner,String(n),JSON.stringify([{type:'image',path:photoPath(n)}]),visibility]);
  }
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[visitor]);
  await pg.query("update private.comment_write_limits set last_write=clock_timestamp()-interval '1 minute'");
  const col={board:'board_post_id',photos:'photo_post_id',diary:'diary_entry_id'}[kind];
  await pg.query(`insert into public.post_comments(id,${col},author_id,author_name,body) values(gen_random_uuid(),$1,$2,'visitor','comment sentinel')`,[p,visitor]);
 }
 await pg.query("select set_config('request.jwt.claim.sub','',false)");
 await pg.query("select public.member_writing_session('create_v2',$1)",[{site_id:site,member_id:actor,central_session_id:centralSession,proof_id:randomUUID(),token_hash:tokenHash,central_grant:'g'.repeat(43),display_name:'Member',homepage_url:'https://a.test/home/',expires_at:new Date(Date.now()+600000).toISOString(),renewal_hash:'b'.repeat(64),central_delegation:'d'.repeat(43),renewal_expires_at:new Date(Date.now()+86400000).toISOString()}]);
}
export async function activate(pg){
 await pg.query('update private.friend_visibility_state set owner_member_id=$1,media_ready=true,summary_ready=true,pages_ready=true,ready=true',[centralOwner]);
 for(const kind of Object.keys(tables))await pg.query('update public.'+tables[kind]+" set visibility='friends' where id=$1",[post(kind,1)]);
}
