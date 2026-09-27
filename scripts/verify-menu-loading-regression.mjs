// Local-only Step 7 regression runner. No credentials or production endpoints.
import {spawn} from 'node:child_process';import {mkdir,open,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const out=resolve(process.env.VERIFICATION_DIR||'docs/verification/menu-loading-step7/regression');await mkdir(out,{recursive:true});
const browser=new Set(['verify-diary-latest-ui','verify-photo-progressive','verify-friend-photos-browser','verify-friend-home-browser','verify-post-routes-ui','verify-diary-writing','verify-menu-leave-uploads']);
const jobs=['verify-content-readiness-cache','verify-owner-session-cache','verify-owner-session-integration','verify-member-session-runtime','verify-member-session-renewal','verify-friend-content-access','verify-friend-read-renewal','verify-diary-latest','verify-photo-check','verify-friend-visibility-api','verify-friend-comments-api','verify-friend-aggregates-api','verify-friend-diary-filters','verify-friend-photo-client','verify-friend-photo-concurrency','verify-photo-media-concurrency','verify-member-comments','verify-member-guestbook','verify-post-location','verify-friend-visibility-setup','build-pages','verify-artifact',...browser];
if(!process.env.PLAYWRIGHT_PATH)throw Error('Set PLAYWRIGHT_PATH');const results=[];
for(const name of jobs){const file=await open(resolve(out,name+'.log'),'w'),start=Date.now();let code;
 try{code=await new Promise((done,reject)=>{const child=spawn(process.execPath,['scripts/'+name+'.mjs',...(browser.has(name)?[process.env.PLAYWRIGHT_PATH]:[])],{env:{...process.env,...(name==='verify-member-guestbook'?{PLAYWRIGHT_PATH:''}:{}),VERIFICATION_DIR:resolve(out,name)},stdio:['ignore',file.fd,file.fd]});child.on('error',reject);child.on('exit',done);});}finally{await file.close();}
 results.push({name,exitCode:code,elapsedMs:Date.now()-start});await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(name+': '+(code===0?'PASS':'FAIL'));
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
