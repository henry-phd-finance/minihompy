// Runs exactly the shipped Worker in an isolated browser; no network or credentials.
import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
export async function createEncoder({playwrightModule,chromiumPath}){
 const {chromium}=await import(pathToFileURL(resolve(playwrightModule)));
 const browser=await chromium.launch({headless:true,executablePath:chromiumPath});
 try{
 const page=await browser.newPage();page.setDefaultTimeout(15000);
 const allowed=new Set(['photo-variant-client.js','photo-variant-worker.js','photo-variant-format.js']);
 await page.route('**/*',async route=>{const u=new URL(route.request().url()),name=u.pathname.slice(1);
  if(u.origin!=='https://encoder.invalid'||name&&!allowed.has(name))return route.abort();
  return route.fulfill({contentType:name?'text/javascript':'text/html',body:name?await readFile(new URL('../'+name,import.meta.url),'utf8'):'<script src="/photo-variant-client.js"></script>'});
 });await page.goto('https://encoder.invalid/');
 return {close:()=>browser.close(),async convert(bytes,{signal}={}){
  if(signal?.aborted)throw Object.assign(Error('ABORTED'),{code:'ABORTED'});
  const abort=()=>void browser.close();signal?.addEventListener('abort',abort,{once:true});
  try{const out=await page.evaluate(async encoded=>{const b=new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]);const v=await MinihompyPhotoVariant.convert(b);if(!v)return null;return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(v);});},Buffer.from(bytes).toString('base64'));return out?new Uint8Array(Buffer.from(out,'base64')):null;}
  finally{signal?.removeEventListener('abort',abort);}
 }};
 }catch(e){await browser.close();throw e;}
}
