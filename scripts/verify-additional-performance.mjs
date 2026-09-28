// Sequential integration audit; synthetic data only. Live diagnosis/measurements run separately.
import {spawn} from 'node:child_process';import {mkdir,open,writeFile,readFile} from 'node:fs/promises';
const out=process.env.VERIFICATION_DIR||'/tmp/additional-performance-regression';await mkdir(out,{recursive:true});
const browser=process.argv[2],results=process.env.RETRY_FAILED ? JSON.parse(await readFile(out+'/results.json','utf8')) : [];
if(!browser)throw Error('Pass the installed Playwright module path as the first argument.');
const tests=['verify-setup','verify-folder-visibility-setup','verify-friend-visibility-setup','verify-friend-visibility-install-concurrency','verify-friend-visibility-integration','verify-friend-photo-concurrency','verify-photo-variants','verify-additional-performance-install','verify-relationship-health','verify-relationship-state','verify-home-refresh','verify-author-cache','verify-author-visit','verify-visitor-identity-client','verify-member-session-startup','verify-member-session-runtime','verify-member-session-client','verify-owner-session-cache','verify-owner-session-integration','verify-member-session-integration','verify-friend-review-history','verify-home-greeting-history-db','verify-photo-variant-reads','verify-photo-display-contract','verify-friend-photo-client','verify-photo-variant-client'];
const browserTests=['verify-friend-reviews-ui','verify-home-greeting-history-ui','verify-photo-visibility-ui','verify-friend-photos-browser','verify-photo-backfill'];
for(const name of [...tests,...browserTests]){
 if(process.env.RETRY_FAILED && results.find(r=>r.name===name)?.status===0)continue;
 const file=await open(out+'/'+name+'.txt','w'),start=Date.now();
 const status=await new Promise(resolve=>{const p=spawn(process.execPath,['scripts/'+name+'.mjs',...(browser?[browser]:[])],{env:{...process.env,MINIHOMPY_TEST_VARIANT_READ:'1',VERIFICATION_DIR:'/tmp/step12-'+name},stdio:['ignore',file.fd,file.fd]});p.on('error',()=>resolve(-1));p.on('close',resolve);});await file.close();const result={name,status,elapsedMs:Date.now()-start},index=results.findIndex(r=>r.name===name);if(index<0)results.push(result);else results[index]=result;console.log((status===0?'PASS ':'FAIL ')+name);
 await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');
}
if(results.some(r=>r.status!==0))process.exitCode=1;
