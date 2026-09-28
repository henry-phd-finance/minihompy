import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile, rm, lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const name=`minihompy-installer-${pkg.version}`, output=join(root,'dist'), stage=join(output,name);
const hash=data=>createHash('sha256').update(data).digest('hex');
// Only tracked, selected source files. Never copy local setup state or deployed identity proofs.
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const scripts=['build-pages.mjs','verify-artifact.mjs','migrate-photo-media.mjs','backfill-photo-variants.mjs'];
const docs=['install-and-upgrade','deployment','configuration','login-flow','member-writing-deployment','member-session-deployment','member-navigation-deployment','home-data-deployment','folder-visibility-deployment','member-relationship-deployment','friend-visibility-deployment','photo-media-migration','photo-variant-backfill','visit-counts-contract'];
const selected=tracked.filter(path=>
  ['index.html','author-visit.html','styles.css','.gitignore','.github/workflows/pages.yml'].includes(path) ||
  /^[^/]+\.js$/.test(path) || /^(assets|views|login)\//.test(path) ||
  /^setup\/[^/]+\.mjs$/.test(path) || path==='setup/config.example.json' ||
  /^supabase\/(migrations\/[^/]+\.sql|functions\/.+\.(js|ts)|config\.toml)$/.test(path) ||
  docs.some(doc=>path==='docs/'+doc+'.md') || scripts.some(s=>path==='scripts/'+s));
await mkdir(output,{recursive:true});await rm(stage,{recursive:true,force:true});await mkdir(stage);
const files={};
async function save(path,content){await mkdir(dirname(join(stage,path)),{recursive:true});await writeFile(join(stage,path),content);files[path]=hash(content);}
for(const path of selected.sort()){
  if(!(await lstat(join(root,path))).isFile())throw Error('Non-regular source: '+path);
  await save(path,await readFile(join(root,path)));
}
const config=(global,value)=>`// Installation template. Configure this site through setup/setup.mjs.\nwindow.${global} = Object.freeze(${JSON.stringify(value,null,2)});\n`;
await save('supabase-config.js',config('MINIHOMPY_SUPABASE',{url:'',publishableKey:''}));
await save('visitor-identity-config.js',config('MINIHOMPY_VISITOR_IDENTITY_CONFIG',{enabled:false,siteId:'',handle:'',centralApiUrl:'',centralPageUrl:''}));
await save('member-writing-config.js',config('MINIHOMPY_MEMBER_WRITING_CONFIG',{enabled:false}));
await save('home-data-config.js',config('MINIHOMPY_HOME_DATA_CONFIG',{enabled:false}));
await save('README.md',await readFile(join(root,'setup/README.md')));
await save('setup/README.md',await readFile(join(root,'setup/README.md')));
await save('package.json',JSON.stringify({...pkg,scripts:{setup:pkg.scripts.setup,build:pkg.scripts.build,'test:artifact':pkg.scripts['test:artifact']}},null,2)+'\n');
const manifest={version:pkg.version,sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:Object.fromEntries(Object.entries(files).sort())};
await writeFile(join(stage,'installer-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
// Stable archive metadata makes repeated builds of identical inputs byte-for-byte identical.
execFileSync('tar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',join(output,name+'.tar.gz'),'-C',output,name]);
await writeFile(join(output,name+'.tar.gz.sha256'),hash(await readFile(join(output,name+'.tar.gz')))+'  '+name+'.tar.gz\n');
console.log(`Built dist/${name}.tar.gz (${Object.keys(files).length} files), SHA-256 sidecar and unpacked directory.`);
