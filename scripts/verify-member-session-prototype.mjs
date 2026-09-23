// Step 1 architecture experiment only: in-memory servers, not production handlers.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const secret=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('base64url');
let now=0,revoked=false,offline=false;
const absolute=30*86400000,proofs=new Map(),delegations=new Map(),servers=[];
const centralLogin=secret();
const deny=(status=401)=>{throw Object.assign(Error('denied'),{status});};
const active=()=>{if(revoked||now>=absolute)deny();};
async function serve(handler){
 const server=createServer(async(req,res)=>{
  try{const chunks=[];for await(const c of req)chunks.push(c);
   const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
   const value=await handler(req,body);res.setHeader('Cache-Control','no-store');
   if(typeof value==='string'){res.setHeader('Content-Type','text/html');res.end(value);}
   else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}
  }catch(e){res.writeHead(e.status||500);res.end('{}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);
 return `http://127.0.0.1:${server.address().port}`;
}
async function post(url,body,token){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});if(!r.ok)deny(r.status);return r.json();}
let central,A,B;
const allowed=new Map();
central=await serve(async(req,b)=>{
 if(req.url==='/seed')return '<p>fixture login seed</p>';
 if(req.url==='/visit')return `<script>
 (async()=>{const q=new URLSearchParams(location.search);const r=await fetch('/issue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:localStorage.login,site:q.get('site'),challenge:q.get('challenge')})});const d=await r.json();location.replace(d.target+'/#'+new URLSearchParams({proof:d.proof,state:q.get('state')}));})();</script>`;
 // Query string handled below by normalized server URL.
 if(offline)deny(503);
 if(req.url==='/issue'){
  if(b.login!==centralLogin)deny();active();if(!allowed.has(b.site))deny(403);
  const proof=secret();proofs.set(hash(proof),{site:b.site,challenge:b.challenge,expires:now+60000});
  return {proof,target:allowed.get(b.site)};
 }
 if(req.url==='/redeem'){
  active();const p=proofs.get(hash(b.proof||''));if(!p||p.expires<=now)deny();
  if(p.site!==b.site||p.challenge!==hash(b.verifier||''))deny(403);
  proofs.delete(hash(b.proof));const delegation=secret();delegations.set(hash(delegation),{site:p.site});
  return {delegation,expires:Math.min(now+900000,absolute)};
 }
 if(req.url==='/renew'){
  active();const d=delegations.get(hash(req.headers.authorization?.slice(7)||''));if(!d)deny();
  if(d.site!==b.site)deny(403);return {expires:Math.min(now+900000,absolute)};
 }deny(404);
});
// Keep the browser route's query while matching its pathname.
servers[0].prependListener('request',req=>{req.url=new URL(req.url,central).pathname;});
function personal(site){
 const families=new Map(),access=new Map();
 return serve(async(req,b)=>{
  if(req.url==='/')return `<textarea id="draft"></textarea><script>
  window.boot=async()=>{const q=new URLSearchParams(location.hash.slice(1));if(!q.has('proof'))return;
  if(q.get('state')!==sessionStorage.state)throw Error('state');
  const proof=q.get('proof');history.replaceState(null,'','/');
  const r=await fetch('/exchange',{method:'POST',body:JSON.stringify({proof,verifier:sessionStorage.verifier})});if(!r.ok)throw Error('exchange');
  const s=await r.json();sessionStorage.refresh=s.refresh;sessionStorage.access=s.access;window.ready=true;};
  window.renew=async()=>{const r=await fetch('/renew',{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.refresh},body:'{}'});if(r.ok)sessionStorage.access=(await r.json()).access;return r.status;};boot();</script>`;
  if(req.url==='/exchange'){
   const d=await post(central+'/redeem',{...b,site});const refresh=secret(),token=secret();
   families.set(hash(refresh),{delegation:d.delegation,expires:absolute});access.set(hash(token),d.expires);
   return {refresh,access:token,expires:d.expires};
  }
  const token=req.headers.authorization?.slice(7)||'';
  if(req.url==='/content'){if(!(access.get(hash(token))>now))deny();active();return {ok:true};}
  if(req.url==='/renew'){
   const f=families.get(hash(token));if(!f||f.expires<=now)deny();
   const d=await post(central+'/renew',{site},f.delegation);const tokenNew=secret();access.set(hash(tokenNew),d.expires);
   return {access:tokenNew,expires:d.expires};
  }deny(404);
 });
}
A=await personal('A');B=await personal('B');allowed.set('A',A);allowed.set('B',B);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const results=[];const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS: '+name);};
try{
 const ctx=await browser.newContext();const page=await ctx.newPage();
 await page.goto(central+'/seed');await page.evaluate(v=>localStorage.login=v,centralLogin);
 for(const [site,url]of [['A',A],['B',B]]){
  await page.goto(url);const verifier=secret(),state=secret();
  await page.evaluate(({verifier,state})=>{sessionStorage.verifier=verifier;sessionStorage.state=state;},{verifier,state});
  await page.goto(central+'/visit?'+new URLSearchParams({site,challenge:hash(verifier),state}));
  await page.waitForFunction(()=>window.ready===true);
  await check(site+' first top-level visit exchanges a PKCE proof',async()=>assert.equal(new URL(page.url()).origin,url));
 }
 let navigations=0;page.on('framenavigated',()=>navigations++);
 await page.locator('#draft').fill('fixture draft');await page.locator('#draft').focus();
 let blockedCentralRequests=0;await page.route(central+'/**',route=>{blockedCentralRequests++;return route.abort();}); // No browser-to-central traffic or frames during renewal.
 await check('expired access rejected, independent refresh survives inactivity',async()=>{
  now=3600000;
  assert.equal(await page.evaluate(async()=> (await fetch('/content',{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.access},body:'{}'})).status),401);
  assert.equal(await page.evaluate(()=>renew()),200);
 });
 await check('renewal preserves URL, draft, focus; no central browser access/popups',async()=>{
  assert.equal(blockedCentralRequests,0);assert.equal(navigations,0);assert.equal(ctx.pages().length,1);assert.equal(page.url(),B+'/');
  assert.equal(await page.locator('#draft').inputValue(),'fixture draft');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'draft');
  assert.equal(await page.evaluate(()=>localStorage.getItem('login')),null);
 });
 await check('refresh cannot authorize content or another personal site',async()=>{
  const refresh=await page.evaluate(()=>sessionStorage.refresh);
  await assert.rejects(post(B+'/content',{},refresh),e=>e.status===401);
  await assert.rejects(post(A+'/renew',{},refresh),e=>e.status===401);
 });
 await check('central delegation is site bound',async()=>{
  const v=secret(),p=await post(central+'/issue',{login:centralLogin,site:'A',challenge:hash(v)});
  await assert.rejects(post(central+'/redeem',{proof:p.proof,site:'B',verifier:v}),e=>e.status===403);
  const d=await post(central+'/redeem',{proof:p.proof,site:'A',verifier:v});
  await assert.rejects(post(central+'/renew',{site:'B'},d.delegation),e=>e.status===403);
  await assert.rejects(post(central+'/redeem',{proof:p.proof,site:'A',verifier:v}),e=>e.status===401);
 });
 await check('anonymous issue, wrong PKCE and expired proof denied',async()=>{
  const v=secret();await assert.rejects(post(central+'/issue',{site:'B',challenge:hash(v)}),e=>e.status===401);
  const p=await post(central+'/issue',{login:centralLogin,site:'B',challenge:hash(v)});
  await assert.rejects(post(central+'/redeem',{proof:p.proof,site:'B',verifier:secret()}),e=>e.status===403);
  now+=60001;await assert.rejects(post(central+'/redeem',{proof:p.proof,site:'B',verifier:v}),e=>e.status===401);
 });
 await check('outage distinct from logout, recovery keeps draft',async()=>{
  offline=true;assert.equal(await page.evaluate(()=>renew()),503);offline=false;
  assert.equal(await page.evaluate(()=>renew()),200);assert.equal(await page.locator('#draft').inputValue(),'fixture draft');
 });
 await check('central logout denies delegated renewal',async()=>{revoked=true;assert.equal(await page.evaluate(()=>renew()),401);revoked=false;});
 await check('central absolute expiry cannot be extended',async()=>{now=absolute;assert.equal(await page.evaluate(()=>renew()),401);});
 console.log(JSON.stringify({passed:results.length,scope:'HTTP/browser architecture fixture; not production SQL or API implementation',centralBrowserRequestsDuringRenewal:0}));
}finally{await browser.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}
