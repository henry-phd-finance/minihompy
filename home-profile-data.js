(() => {
 'use strict';
 const bucket='minihompy-home-profile',extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
 const pattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;
 const checked=r=>{if(r.error)throw r.error;return r.data;};
 async function storage(){const c=window.MinihompyBackend.getClient('admin');if((await window.createMinihompyIdentity(c).current()).role!=='admin')throw Error('홈 주인 로그인이 필요합니다.');return c.storage.from(bucket);}
 window.MinihompyHomeProfileRepository=Object.freeze({
  url(path){return pattern.test(path||'')?window.MinihompyBackend.getClient('visitor').storage.from(bucket).getPublicUrl(path).data.publicUrl:null;},
  filePath(file){if(!extensions[file.type]||file.size<=0||file.size>6291456)throw Error('JPG, PNG, WEBP, GIF 사진을 6MB 이하로 선택해 주세요.');return `${crypto.randomUUID()}.${extensions[file.type]}`;},
  async upload(path,file){
   if(!pattern.test(path))throw Error('사진 경로를 확인해 주세요.');
   const s=await storage(),r=await s.upload(path,file,{contentType:file.type,upsert:false,cacheControl:'31536000'});
   if(r.error&&String(r.error.statusCode)==='409'){const remote=checked(await s.download(path));const a=new Uint8Array(await remote.arrayBuffer()),b=new Uint8Array(await file.arrayBuffer());if(a.length===b.length&&a.every((x,i)=>x===b[i]))return;}
   checked(r);
  },
  async save(row){
   const path=row.payload.profile.imagePath;
   if(typeof path!=='string'||path!==''&&!pattern.test(path))throw Error('사진 경로를 확인해 주세요.');
   // Same settings revision protects concurrent edits to greeting, menus and title.
   return window.MinihompySettings.save(row.payload,row.revision);
  },
  async cleanup(path){if(pattern.test(path||''))checked(await (await storage()).remove([path]));},
 });
})();
