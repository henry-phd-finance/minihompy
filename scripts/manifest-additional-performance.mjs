// Local source inventory only; never reads private env/setup state or contacts servers.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.env.VERIFICATION_DIR||'docs/verification/additional-performance-step12';
const preserved=['config.js','supabase-config.js','visitor-identity-config.js','member-writing-config.js','home-data-config.js'];
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const files={};
for(const path of tracked.sort()){
 if(preserved.includes(path))continue;
 if(!(/^[^/]+\.js$/.test(path)||['index.html','author-visit.html','styles.css','package.json','.github/workflows/pages.yml'].includes(path)||/^(assets|views|login|supabase|setup)\//.test(path)||/^scripts\/(build-pages|verify-artifact|build-installer|backfill-photo-variants|migrate-photo-media)\.mjs$/.test(path)))continue;
 if(/(^|\/)(\.env[^/]*|config\.json|\.temp|node_modules)(\/|$)/.test(path))throw Error('Private source excluded: '+path);
 files[path]=createHash('sha256').update(await readFile(path)).digest('hex');
}
const changed=execFileSync('git',['diff','--name-only','6c254054039b397fa763fd95199b4a04d4ac8bd1'],{encoding:'utf8'}).trim().split('\n').filter(path=>Object.hasOwn(files,path)).sort();
const manifest={functionsToDeploy:['member-writing','photo-media'],changedFromBaseline:changed,version:JSON.parse(await readFile('package.json','utf8')).version,baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineCommit:'6c254054039b397fa763fd95199b4a04d4ac8bd1',sourceSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),preservedSiteFiles:preserved,files};
await mkdir(out,{recursive:true});await writeFile(out+'/source-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log('Recorded '+Object.keys(files).length+' source hashes: '+manifest.sourceSha256);
