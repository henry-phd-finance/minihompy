import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {verifyNavigationSetup} from '../setup/navigation-setup.mjs';
const config={...JSON.parse(await readFile(new URL('../setup/config.example.json',import.meta.url),'utf8')),siteId:'00000000-0000-4000-8000-000000000001'};
const target=await mkdtemp(join(tmpdir(),'navigation-setup-'));const files=['member-navigation.js','author-navigation.js','surf-navigation.js'];
try{
 for(const file of files)await writeFile(join(target,file),'');await writeFile(join(target,'index.html'),files.map(f=>`<script src="${f}"></script>`).join(''));
 const fetcher=async url=>new Response(JSON.stringify(url.endsWith('/health')?{navigation_protocol:1}:url.includes('/navigation/site')?{item:{site_id:config.siteId,homepage_url:`https://${config.githubUser}.github.io/${config.githubRepo}/`}}:{items:[],next_cursor:null}),{status:200});
 await verifyNavigationSetup({config,target,fetcher,log:()=>{}});
 await verifyNavigationSetup({config,target,dryRun:true,fetcher:()=>{throw Error('Unexpected network')},log:()=>{}});
 await assert.rejects(()=>verifyNavigationSetup({config,target,fetcher:async()=>new Response('{}'),log:()=>{}}),/먼저 배포/);
 await rm(join(target,files[0]));await assert.rejects(()=>verifyNavigationSetup({config,target,dryRun:true,log:()=>{}}),/ENOENT/);
 console.log('PASS: navigation install/upgrade readiness, dry run, old central and missing module rejection');
}finally{await rm(target,{recursive:true,force:true});}
