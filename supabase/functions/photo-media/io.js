// Shared by the Edge and the offline migration tool; no public/signed URL helper.
export const BUCKET='minihompy-photos-private',LEGACY_BUCKET='minihompy-photos',MAX_BYTES=6291456;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATH=new RegExp('^'+UUID.source.slice(1,-1)+'/'+UUID.source.slice(1,-1)+'\\.(jpg|png|webp|gif)$');
export function validPath(post,path){return UUID.test(post||'')&&typeof path==='string'&&PATH.test(path)&&path.startsWith(post+'/');}
export function fail(code){throw Object.assign(new Error(code),{code});}
export async function bytesOf(body,max=MAX_BYTES,timeout=15000){
 const reader=body?.getReader();if(!reader)fail('BAD_REQUEST');
 let timer,total=0;const parts=[],deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('REQUEST_TIMEOUT'),{code:'REQUEST_TIMEOUT'})),timeout);});
 try{for(;;){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;total+=value.length;if(total>max)fail('TOO_LARGE');parts.push(value);}
 const out=new Uint8Array(total);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function imageType(bytes,path){
 if(!bytes.length||bytes.length>MAX_BYTES)fail('TOO_LARGE');
 const s=new TextDecoder('latin1').decode(bytes.slice(0,12));
 let mime,ext;
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){mime='image/jpeg';ext='jpg';}
 else if(bytes.slice(0,8).every((b,i)=>b===[137,80,78,71,13,10,26,10][i])&&bytes.length>=8){mime='image/png';ext='png';}
 else if(s.startsWith('GIF87a')||s.startsWith('GIF89a')){mime='image/gif';ext='gif';}
 else if(s.startsWith('RIFF')&&s.slice(8,12)==='WEBP'){mime='image/webp';ext='webp';}
 else fail('BAD_IMAGE');
 if(!path.endsWith('.'+ext))fail('BAD_IMAGE');return mime;
}
export function adapters({projectUrl,serviceKey,fetcher=fetch}){
 const headers={apikey:serviceKey,Authorization:'Bearer '+serviceKey};
 async function request(path,options={}){
  const r=await fetcher(projectUrl+path,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok){void r.body?.cancel();fail(r.status===404?'NOT_FOUND':'STORAGE_UNAVAILABLE');}return r;
 }
 return {
  rpc:async(action,args={})=>{
   const r=await request('/rest/v1/rpc/photo_media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_args:args})});
   const value=await r.json();if(value?.failure)fail(value.failure);return value;
  },
  storage:{
   get:async(bucket,path)=>bytesOf((await request('/storage/v1/object/authenticated/'+bucket+'/'+path)).body),
   put:async(bucket,path,bytes,mime)=>{await request('/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false','Cache-Control':'no-store'},body:bytes});},
   remove:async(bucket,paths)=>{await request('/storage/v1/object/'+bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths})});},
   bucket:async(bucket)=>(await request('/storage/v1/bucket/'+bucket)).json(),
   close:async(bucket)=>{await request('/storage/v1/bucket/'+bucket,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false})});},
   list:async(bucket,prefix='',offset=0)=>(await request('/storage/v1/object/list/'+bucket,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}})})).json()
  }
 };
}
export async function immutableCopy(storage,bucket,path,bytes,mime){
 const hash=await digest(bytes);
 try{await storage.put(bucket,path,bytes,mime);}catch{
  // Covers duplicate name AND upload success with a lost response. Never upsert.
  const existing=await storage.get(bucket,path);if(await digest(existing)!==hash)fail('REQUEST_CONFLICT');
 }
 const copied=await storage.get(bucket,path);
 if(copied.length!==bytes.length||await digest(copied)!==hash)fail('INTEGRITY_FAILURE');
}
