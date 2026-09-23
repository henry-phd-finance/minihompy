import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root=resolve('_site');
async function walk(dir) {const paths=[];for(const item of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,item.name); if(item.isDirectory())paths.push(...await walk(p));else paths.push(p);}return paths;}
const paths=await walk(root);
for(const required of ['index.html','login/index.html','assets/login-flow.js','assets/login.css','visitor-identity-login.js','visitor-identity.js'])assert.ok(paths.includes(resolve(root,required)),required);
for(const path of paths){
  assert.ok(!/\.(sql|ts|toml|env)$/.test(path) && !/(?:^|\/)(?:setup|scripts|supabase|docs|node_modules|\.env)(?:\/|$)/.test(path.slice(root.length)),path);
  if(!path.endsWith('.html'))continue;
  const html=await readFile(path,'utf8');
  for(const [,link] of html.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)){
    if(/^(?:https?:|data:|mailto:|app:)/.test(link))continue;
    assert.ok(paths.includes(resolve(dirname(path),link)),`Missing ${link} from ${path}`);
  }
}
console.log('PASS: Pages includes login/runtime assets and excludes backend/setup/secrets.');
