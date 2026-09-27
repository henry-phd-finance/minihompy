#!/usr/bin/env node
// No .env loading. Supply credentials through the process environment.
import {readFile,writeFile,mkdir,rename,realpath,stat,rm} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {adapters,validPath} from '../supabase/functions/photo-media/io.js';
import {migratePhotos} from '../setup/photo-media-migration.mjs';
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('Usage: node scripts/migrate-photo-media.mjs --phase inventory|copy|protect|close-legacy --journal-dir /private/outside-repository [--apply]\nDefault: read-only dry-run. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Never enables ready.');process.exit(0);
}
let lock;
try{
 const phase=args.includes('--phase')?args[args.indexOf('--phase')+1]:'inventory',raw=args.includes('--journal-dir')?args[args.indexOf('--journal-dir')+1]:null;
 const known=new Set(['--phase','--journal-dir','--apply']);
 for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw Error('Invalid argument');if(args[i]!=='--apply')i++;}
 if(!raw||!process.env.SUPABASE_SERVICE_ROLE_KEY||!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(process.env.SUPABASE_URL||''))throw Error('Configuration required');
 const directory=resolve(raw),root=await realpath(new URL('../',import.meta.url));
 await mkdir(directory,{recursive:true,mode:0o700});
 const actual=await realpath(directory),inside=relative(root,actual);
 if(!inside||(!inside.startsWith('..'+sep)&&inside!=='..'))throw Error('Journal must be outside repository');
 if(((await stat(actual)).mode&0o077)!==0)throw Error('Journal directory must have mode 0700');
 if(args.includes('--apply')){const p=resolve(actual,'run.lock');await mkdir(p,{mode:0o700});lock=p;}
 const filename=resolve(actual,'journal.json');let record;
 try{record=JSON.parse(await readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(record&&record.project!==process.env.SUPABASE_URL)throw Error('Journal project mismatch');
 const api=adapters({projectUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
 const backupPath=path=>{if(!validPath(path.split('/')[0],path))throw Error('Invalid path');return resolve(actual,'backup',path);};
 const result=await migratePhotos({...api,phase,dryRun:!args.includes('--apply'),journal:record,
  save:async j=>{j.project=process.env.SUPABASE_URL;await writeFile(filename+'.tmp',JSON.stringify(j,null,2)+'\n',{mode:0o600});await rename(filename+'.tmp',filename);},
  backup:async(path,bytes)=>{const file=backupPath(path);await mkdir(dirname(file),{recursive:true,mode:0o700});try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const old=await readFile(file);if(!old.equals(Buffer.from(bytes)))throw Error('Existing backup mismatch');}},
  loadBackup:path=>readFile(backupPath(path))
 });
 console.log(JSON.stringify(result));
}catch(e){console.error('Photo migration stopped:',e.code||e.message);process.exitCode=1;}finally{if(lock)await rm(lock,{recursive:true});}
