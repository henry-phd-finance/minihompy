// Read-only live authentication diagnosis. No content/relation/statistics mutations.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
if(process.env.MINIHOMPY_LIVE_READ!=='1')throw Error('Explicit MINIHOMPY_LIVE_READ=1 required');
if(process.env.MINIHOMPY_ENV_FILE)process.loadEnvFile(process.env.MINIHOMPY_ENV_FILE);
const out=process.env.VERIFICATION_DIR||'/tmp/initial-identity';await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const homes={A:'https://henry-phd-finance.github.io/minihompy/',B:'https://henry-hs-jung.github.io/minihompy/'};
const report={delayedAuth:process.env.MINIHOMPY_DELAY_AUTH==='1',overlay:process.env.MINIHOMPY_IDENTITY_OVERLAY==='1',events:[],samples:[],blockedWrites:0};
const ctx=await browser.newContext();await ctx.exposeBinding('recordIdentity',(_,event)=>report.events.push(event));
await ctx.addInitScript(()=>{Object.defineProperty(navigator,'locks',{value:undefined});for(const name of ['minihompy:identity','minihompy:visitor-identity','minihompy:member-session','minihompy:writing-reset'])addEventListener(name,e=>{void window.recordIdentity({event:name,status:e.detail?.status,role:e.detail?.role,reason:e.detail?.reason,adminPresent:!!window.MinihompyAdmin,documentState:document.readyState});});});
await ctx.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
 if(!['GET','HEAD','OPTIONS'].includes(req.method())){
  const allowed=/\/auth\/v1\/(token|logout)$/.test(u.pathname)||/\/functions\/v1\/owner-login$/.test(u.pathname)||/\/functions\/v1\/(identity-api|identity-page)\/(login-intents|login-context|activation-tickets|visits|login|logout|session|sessions|writing-proofs|writing-sessions|relationships|auth|attempts)(\/|$)/.test(u.pathname)||/\/functions\/v1\/member-writing\/(sessions\/|content\/(list|health|calendar|photo-check|summary|location)$|relationships\/state$)/.test(u.pathname)||/\/functions\/v1\/photo-media\/read$/.test(u.pathname)||/\/rest\/v1\/rpc\/(is_minihompy_admin|home_summary|diary_written_dates|post_location)$/.test(u.pathname);
  if(!allowed||/\/relationships\/(actions|review-permits)$/.test(u.pathname)){report.blockedWrites++;return route.abort();}
 }
 if(report.delayedAuth&&(u.pathname.endsWith('/admin-auth.js')||u.pathname.endsWith('/sessions/exchange'))){const response=await route.fetch();await new Promise(r=>setTimeout(r,u.pathname.endsWith('/admin-auth.js')?1800:2200));return route.fulfill({response});}
 if(u.pathname.endsWith('/visitor-identity.js')){
  let text=report.overlay?await readFile('visitor-identity.js','utf8'):await(await route.fetch()).text();
  text=text.replace('await window.MinihompyAdmin?.refresh?.();',"await window.recordIdentity({event:'before-admin-refresh',adminPresent:!!window.MinihompyAdmin,documentState:document.readyState});await window.MinihompyAdmin?.refresh?.();");
  text=text.replace('} catch {\n          if (current !== generation)',"} catch (error) {\n          void window.recordIdentity({event:'identity-return-error',code:error.code||null,message:['로그인 상태가 변경되었습니다.','Unrelated return','작성 인증 증명이 없습니다.'].includes(error.message)?error.message:'other'});\n          if (current !== generation)");return route.fulfill({contentType:'text/javascript',body:text});
 }
 return route.continue();
});
const page=await ctx.newPage();page.setDefaultTimeout(45000);
const settle=async label=>{await page.waitForFunction(()=>window.MinihompyAdmin&&['identified','error','anonymous'].includes(window.MinihompySharedIdentity?.state.status)&&!location.hash.startsWith('#vt='));const state=await page.evaluate(()=>({identity:MinihompySharedIdentity.state.status,writing:MinihompyMemberWriting.state.status,admin:MinihompyAdmin?.state.role}));report.samples.push({label,...state});return state;};
try{
 await page.goto(homes.B);await settle('B anonymous');await page.locator('#login-auth-toggle').click();await page.locator('#handle').fill('henry-hs-jung');await page.locator('#submit').click();await page.waitForURL(u=>u.origin===new URL(homes.B).origin&&u.pathname.endsWith('/login/'));await page.locator('#password').fill(process.env.pwB);await page.locator('#submit').click();await page.waitForURL(u=>u.origin===new URL(homes.B).origin&&!u.pathname.endsWith('/login/'));await settle('B login');
 for(const site of ['B','A','B']){await page.goto(homes[site]);await settle(site+' first document');}
}catch(e){report.failure=e.name;}finally{
 try{await page.locator('#login-auth-toggle').click();await page.waitForFunction(()=>window.MinihompySharedIdentity?.state.status==='anonymous');report.logout=true;}catch{report.logout=false;}
 await writeFile(out+'/identity.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({samples:report.samples,failure:report.failure,logout:report.logout,blockedWrites:report.blockedWrites}));
}
