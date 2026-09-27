(() => {
 'use strict';
 const repo=()=>window.MinihompyHomeProfileRepository;
 const owner=()=>window.MinihompyAdmin?.state.role==='admin'?window.MinihompyAdmin.state.userId:null;
 let edit=null,sequence=0;
 const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 function close(){++sequence;if(!edit)return;const s=edit;edit=null;if(s.photo)URL.revokeObjectURL(s.photo.preview);s.dialog.close();s.dialog.remove();s.opener?.isConnected&&s.opener.focus();}
 function valid(s){return edit===s&&owner()===s.owner;}
 function feedback(s,message){if(valid(s))s.message.textContent=message;}
 function busy(s,value){s.busy=value;for(const c of s.form.querySelectorAll('input,textarea,button'))c.disabled=value;s.form.setAttribute('aria-busy',String(value));}
 async function save(s,event){
  event.preventDefault();if(!valid(s)||s.busy)return;
  s.row.payload.profile.introduction=s.greeting.value;
  try{window.MinihompySettings.validate(s.row.payload);}catch(e){feedback(s,e.message);return;}
  busy(s,true);feedback(s,'저장 중입니다.');const photo=s.photo;
  try{
   if(photo){await repo().upload(s.row.payload.profile.imagePath,photo.file);photo.uploaded=true;}
   if(!valid(s)){if(photo&&!photo.submitted)void repo().cleanup(s.row.payload.profile.imagePath).catch(()=>{});return;}
   if(photo)photo.submitted=true;
   await repo().save(s.row); // Settings publication re-renders the home for everyone reading it.
   if(!valid(s))return;
   const previous=s.previous,next=s.row.payload.profile.imagePath;close();
   if(previous!==next)void repo().cleanup(previous).catch(()=>{});
  }catch{feedback(s,'저장하지 못했거나 결과를 확인하지 못했습니다. 입력은 유지됩니다. 다시 불러와 저장 여부를 확인해 주세요.');}
  finally{if(valid(s))busy(s,false);}
 }
 async function choose(s,file){
  if(!file||!valid(s)||s.busy)return;
  const ticket=++sequence;let preview;busy(s,true);
  try{
   const path=repo().filePath(file);preview=URL.createObjectURL(file);const image=new Image();image.src=preview;await image.decode();
   if(!valid(s)||ticket!==sequence){URL.revokeObjectURL(preview);return;}
   if(s.photo)URL.revokeObjectURL(s.photo.preview);
   s.photo={file,preview};s.row.payload.profile.imagePath=path;s.preview.src=preview;s.preview.hidden=false;feedback(s,'');
  }catch{if(preview)URL.revokeObjectURL(preview);if(valid(s)&&ticket===sequence)feedback(s,'열 수 있는 JPG, PNG, WEBP, GIF 사진을 6MB 이하로 선택해 주세요.');}
  finally{if(valid(s)&&ticket===sequence)busy(s,false);}
 }
 function open(opener){
  if(!owner()||!window.MinihompySettings.snapshot)return;close();
  const row=window.MinihompySettings.snapshot;row.payload.profile.imagePath ||= '';
  const dialog=el('dialog');dialog.className='home-profile-dialog';dialog.setAttribute('aria-labelledby','home-profile-title');
  const s=edit={row,owner:owner(),previous:row.payload.profile.imagePath,dialog,opener,busy:false,photo:null};
  const title=el('h2','프로필 사진·인사말 수정');title.id='home-profile-title';s.form=el('form');s.form.addEventListener('submit',e=>void save(s,e));
  s.preview=el('img');s.preview.alt='선택한 프로필 사진';const url=repo().url(s.previous);s.preview.hidden=!url;if(url)s.preview.src=url;
  const photoLabel=el('label','프로필 사진 (6MB 이하)'),file=el('input');file.type='file';file.accept='image/jpeg,image/png,image/webp,image/gif';file.addEventListener('change',()=>void choose(s,file.files[0]));photoLabel.append(file);
  const reset=el('button','기본 캐릭터로');reset.type='button';reset.onclick=()=>{++sequence;if(s.photo)URL.revokeObjectURL(s.photo.preview);s.photo=null;s.row.payload.profile.imagePath='';s.preview.hidden=true;file.value='';};
  const caption=el('label','인사말');s.greeting=el('textarea');s.greeting.maxLength=2000;s.greeting.rows=5;s.greeting.value=row.payload.profile.introduction;caption.append(s.greeting);
  s.message=el('p');s.message.setAttribute('role','status');const actions=el('div');actions.className='home-profile-editor-actions';
  const submit=el('button','저장');submit.type='submit';const cancel=el('button','취소');cancel.type='button';cancel.onclick=close;
  const reload=el('button','다시 불러오기');reload.type='button';reload.onclick=async()=>{busy(s,true);await window.MinihompySettings.load();if(!valid(s))return;if(window.MinihompySettings.status==='ready')open(document.querySelector('[data-home-profile-edit]'));else{busy(s,false);feedback(s,'설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');}};
  actions.append(submit,cancel,reload);s.form.append(s.preview,photoLabel,reset,caption,s.message,actions);dialog.append(title,s.form);document.body.append(dialog);
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(!s.busy)close();});dialog.showModal();s.greeting.focus();
 }
 function attach(root){
  const slot=root.querySelector('.profile-image-slot'),button=root.querySelector('[data-home-profile-edit]');
  const path=window.MINIHOMPY_CONFIG?.profile?.imagePath,url=repo().url(path);
  if(url){slot.classList.remove('reference-sprite');slot.removeAttribute('role');slot.removeAttribute('aria-label');const img=el('img');img.src=url;img.alt='프로필 사진';slot.append(img);}
  button.hidden=!owner();button.onclick=()=>open(button);
 }
 window.addEventListener('minihompy:identity',()=>{if(edit&&owner()!==edit.owner)close();for(const b of document.querySelectorAll('[data-home-profile-edit]'))b.hidden=!owner();});
 window.addEventListener('minihompy:menu-leave',e=>{if(e.detail.id===null||e.detail.id==='home')close();});
 window.addEventListener('pagehide',close);
 window.MinihompyPostRoutes?.guard(()=>edit?{busy:edit.busy,dirty:false}:null);
 window.MinihompyHomeProfile=Object.freeze({attach});
})();
