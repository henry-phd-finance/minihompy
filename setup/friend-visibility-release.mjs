import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export async function friendPagesRelease(root){
 const files={};
 async function add(name){files[name]=sha256(await readFile(join(root,name)));}
 async function walk(dir){for(const e of await readdir(join(root,dir),{withFileTypes:true})){const name=dir+'/'+e.name;if(e.isSymbolicLink())throw Error('Pages symlink is not allowed');if(e.isDirectory())await walk(name);else if(/\.(js|html|css)$/.test(e.name))await add(name);}}
 for(const name of ['index.html','styles.css'])await add(name);
 for(const e of await readdir(root,{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.js'))await add(e.name);
 for(const dir of ['views','login','assets'])await walk(dir);
 const html=await readFile(join(root,'index.html'),'utf8');
 for(const name of ['content-access.js','member-writing-client.js','member-writing-runtime.js','photos-repository.js','photo-media-client.js','post-location-repository.js'])if(!files[name]||!html.includes('src="'+name+'"'))throw Error('Missing friend visibility Pages runtime: '+name);
 const ordered=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0));
 return {protocol:1,files:ordered,sha256:sha256(JSON.stringify(ordered))};
}
