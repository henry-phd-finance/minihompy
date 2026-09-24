// Test-only transport: a constrained Supabase query-builder adapter over real SQL.
// It is not a replacement for PostgREST/Auth and never ships in Pages.
export const browserBackend=`
window.fixtureActor='anon';
const api=(payload,signal)=>fetch('./fixture-db',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,actor:fixtureActor}),signal}).then(r=>r.json());
function query(table){const q={table,op:'select',filters:[],orders:[]};const b={
 select(columns='*'){q.columns=columns;return b;},eq(k,v){q.filters.push([k,v]);return b;},order(k,o={}){q.orders.push([k,o.ascending!==false]);return b;},range(a,z){q.range=[a,z];return b;},maybeSingle(){q.single=true;return b;},insert(value){q.op='insert';q.value=value;return b;},update(value){q.op='update';q.value=value;return b;},delete(){q.op='delete';return b;},then(resolve,reject){return api(q).then(resolve,reject);}};return b;}
const client={from:query,rpc(name,args){let signal;const b={abortSignal(s){signal=s;return b;},then(resolve,reject){return api({rpc:name,args},signal).then(resolve,reject);}};return b;},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'assets/photos/lake.jpg'}}),remove:async()=>({error:null})})}};
window.MinihompyBackend={getClient:()=>client};
window.MinihompyAdmin={state:{role:'reader',userId:null}};
window.createMinihompyIdentity=()=>({current:async()=>MinihompyAdmin.state});
const ctx=()=>({role:MinihompyAdmin.state.role,userId:MinihompyAdmin.state.userId,client,authorName:'Fixture Owner'});
window.MinihompyVisitorSession={context:async()=>ctx(),writer:async()=>ctx(),nickname:()=>''};
window.MinihompyMemberWriting={enabled:()=>false,snapshot:()=>null,check(){}};
window.MinihompyPhotoEditor={active:false};
window.setActor=actor=>{fixtureActor=actor;MinihompyAdmin.state={role:actor==='owner'?'admin':'reader',userId:window.fixtureIds[actor]||null};dispatchEvent(new Event('minihompy:identity'));dispatchEvent(new Event('minihompy:visitor-identity'));};
`;
export function sqlTransport(pg,ids){
 let queue=Promise.resolve();
 const run=fn=>{const promise=queue.then(fn);queue=promise.catch(()=>{});return promise;};
 const name=n=>{if(!/^[a-z_]+$/.test(n))throw Error('Invalid fixture identifier');return '"'+n+'"';};
 const tables=new Set(['minihompy_settings','minihompy_profile','board_folders','board_posts','photo_folders','photo_posts','diary_folders','diary_entries','guestbook_posts','post_comments']);
 async function handle(q){return run(async()=>{
  await pg.exec('begin');
  try{
   const uid=ids[q.actor]||'';await pg.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await pg.exec('set local role '+(uid?'authenticated':'anon'));
   let rows,count;
   if(q.rpc){
    const params={set_content_visibility:['p_kind','p_id','p_visibility','p_expected_version','p_request_id'],manage_content_folders:['p_action','p_args'],home_summary:['p_menus'],post_location:['p_kind','p_id','p_size'],diary_written_dates:['selected_folder','month_start']}[q.rpc];
    if(!params)throw Error('Unexpected fixture RPC');
    rows=(await pg.query(`select public.${name(q.rpc)}(${params.map((_,i)=>'$'+(i+1)).join(',')}) as data`,params.map(k=>q.args[k]))).rows;await pg.exec('commit');return {data:q.rpc==='diary_written_dates'?rows.map(row=>row.data instanceof Date?row.data.toISOString().slice(0,10):row.data):rows[0]?.data??null,error:null};
   }
   if(!tables.has(q.table))throw Error('Unexpected fixture table');
   const values=[],bind=v=>{values.push(typeof v==='object'&&v!==null?JSON.stringify(v):v);return '$'+values.length;};
   const where=()=>q.filters.length?' where '+q.filters.map(([k,v])=>name(k)+'='+bind(v)).join(' and '):'';
   const fields=q.columns==='*'||!q.columns?'*':q.columns.split(',').map(name).join(',');
   let sql;
   if(q.op==='select')sql=`select ${fields} from public.${name(q.table)}`+where();
   else if(q.op==='insert')sql=`insert into public.${name(q.table)} (${Object.keys(q.value).map(name).join(',')}) values (${Object.values(q.value).map(bind).join(',')}) returning ${fields}`;
   else if(q.op==='update')sql=`update public.${name(q.table)} set `+Object.entries(q.value).map(([k,v])=>name(k)+'='+bind(v)).join(',')+where()+` returning ${fields}`;
   else if(q.op==='delete')sql=`delete from public.${name(q.table)}`+where()+` returning ${fields}`;
   else throw Error('Unexpected operation');
   if(q.op==='select'&&q.orders.length)sql+=' order by '+q.orders.map(([k,asc])=>name(k)+(asc?' asc':' desc')).join(',');
   rows=(await pg.query(sql,values)).rows;for(const row of rows)if(row.entry_date instanceof Date)row.entry_date=row.entry_date.toISOString().slice(0,10);count=rows.length;
   if(q.range)rows=rows.slice(q.range[0],q.range[1]+1);
   await pg.exec('commit');return {data:q.single?(rows[0]||null):rows,count,error:null};
  }catch(e){await pg.exec('rollback');return {data:null,error:{message:e.message,code:e.code}};}
 });}
 return {run,handle};
}
