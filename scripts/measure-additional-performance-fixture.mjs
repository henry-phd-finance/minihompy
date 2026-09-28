// Current production widgets with fixed-delay synthetic reads; not an authorization proof.
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {collect,homeSample} from './helpers/additional-performance-metrics.mjs';
const sourceRoot=resolve(process.env.MINIHOMPY_FIXTURE_SOURCE_DIR||'.');const source=file=>readFile(resolve(sourceRoot,file));
const out=process.env.VERIFICATION_DIR||'docs/verification/additional-performance-step1';await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const report={at:new Date().toISOString(),summaryAbortSignalForwarded:true,delaysMs:{health:100,state:150,summary:180,profiles:100,reviews:80},samples:[],transport:'synthetic fixed delays, real relationship/review/author/home widgets; not a permissions test'};
const id=n=>'91000000-0000-4000-8000-'+String(n).padStart(12,'0');
try{for(const scenario of ['friend','nonfriend','empty']){const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.stack));
 await page.route('https://fixture.test/**',async route=>{const u=new URL(route.request().url());let data,delay=0;
  if(u.pathname.includes('/functions/v1/')){
   if(u.pathname.endsWith('/relationships/health')){delay=100;data={relationship_protocol:1,relationship_relay_ready:true,friend_reviews_ready:true};}
   else if(u.pathname.endsWith('/relationships/state')){delay=150;data={state:scenario==='nonfriend'?'none':'accepted',revision:1};}
   else if(u.pathname.endsWith('/navigation/members')){delay=100;data={items:u.searchParams.get('member_ids').split(',').map(id=>({id,handle:'fixture',display_name:'Fixture',site_id:id,homepage_url:'https://fixture.test/'}))};}
   else if(u.pathname.endsWith('/content/summary')){delay=180;data={version:1,as_of:'2026-09-28T00:00:00Z',date:'2026-09-28',timezone:'Asia/Seoul',menus:['board'],recent:[],counts:{board:{today:0,total:0}},today_comments:0};}
   else if(u.pathname.endsWith('/friend-reviews')){delay=80;data={items:scenario==='empty'?[]:[1,3,4].map(n=>({id:id(n+10),author_member_id:id(n),display_name:'Fixture',body:'fixture',created_at:'2026-09-28T00:00:00Z'})),next_cursor:null};}
   else return route.fulfill({status:404,body:''});
   await new Promise(r=>setTimeout(r,delay));return route.fulfill({json:data});
  }
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:(await source('index.html')).toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')});
  try{return route.fulfill({body:await source(u.pathname.slice(1)),contentType:u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':undefined});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://fixture.test/');await page.evaluate(({owner,visitor})=>{
  const base='https://fixture.test/functions/v1/';window.MINIHOMPY_VIEWS={};window.MINIHOMPY_CONFIG={menus:[{id:'board',label:'게시판',visible:true}],profile:{name:'Fixture'}};
  window.MINIHOMPY_SUPABASE={url:'https://fixture.test'};window.MINIHOMPY_HOME_DATA_CONFIG={enabled:true,supabaseUrl:'https://fixture.test',homepage:'https://fixture.test/'};window.MINIHOMPY_VISITOR_IDENTITY_CONFIG={enabled:true,siteId:owner,centralApiUrl:base+'identity-api'};
  window.MinihompyAdmin={state:{role:'reader'}};window.MinihompySharedIdentity={state:{status:'identified',visitor:{id:visitor}}};window.MinihompyNavigation={refresh:async()=>{},state:{status:'other',owner:{id:owner,display_name:'Owner'},visitor:{id:visitor,display_name:'Visitor'}}};
  window.parseMinihompyNavigationProfile=p=>p;window.MinihompyPostRoutes={href:()=> '#/board'};
  const get=async(path,body,signal)=>{const r=await fetch(base+'member-writing'+path,{signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return r.json();};
  window.MinihompyMemberWriting={enabled:()=>true,snapshot:()=>({}),check(){},state:{status:'ready'},review:(path)=>get(path),relationship:(path,body)=>get(path,body)};
  window.MinihompyContentAccess={read:async(_action,_body,{signal}={})=>({data:await get('/content/summary',{},signal)})};
 },{owner:id(2),visitor:id(1)});
 const scripts=['member-relationships-repository.js','friend-reviews-repository.js','author-navigation.js','home-repository.js','member-relationships.js','friend-reviews.js','home-activity.js','views/home.js'];
 const mount=()=>page.evaluate(()=>{document.querySelector('[data-view-slot=main]').replaceChildren(MINIHOMPY_VIEWS.home.createMain());dispatchEvent(new Event('minihompy:navigation-state'));});
 const first=await homeSample(page,async()=>{for(const f of scripts)await page.addScriptTag({url:'https://fixture.test/'+f});await mount();},{timeout:10000});assert(first.settled);report.samples.push({scenario,case:'concurrent-widgets',...first});
 const burst=await homeSample(page,()=>page.evaluate(()=>{dispatchEvent(new Event('focus'));dispatchEvent(new PageTransitionEvent('pageshow'));document.dispatchEvent(new Event('visibilitychange'));}),{timeout:10000});assert(burst.settled);report.samples.push({scenario,case:'focus-burst',...burst});
 const c=collect(page),authorStart=Date.now();await page.evaluate(({id})=>{for(let i=0;i<3;i++)document.querySelector('[data-view-slot=main]').append(MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:id,author_name:'fixture'},'author'));},{id:id(1)});await page.waitForTimeout(30);await page.evaluate(({id})=>document.querySelector('[data-view-slot=main]').append(MinihompyAuthorNavigation.create({author_kind:'member',author_member_id:id,author_name:'fixture'},'author')),{id:id(1)});await page.waitForFunction(()=>!document.querySelector('.author-navigation[data-status=loading]'));report.samples.push({scenario,case:'staggered-same-author',authorLinksReadyMs:Date.now()-authorStart,...await c.finish()});if(process.env.MINIHOMPY_VERIFY_STATE==='1'){
 const changed=await homeSample(page,()=>page.evaluate(()=>{for(let i=0;i<3;i++)dispatchEvent(new Event('minihompy:relationship-change'));}),{timeout:10000});
 assert.equal(first.counts['relationships/state'],1);assert.equal(burst.counts['relationships/state'],1);assert.equal(changed.counts['relationships/state'],1);
 report.samples.push({scenario,case:'relationship-change-burst',...changed});
 }
 assert.deepEqual(errors,[]);await page.close();console.log('Fixture '+scenario+' complete');
}}finally{await browser.close();await writeFile(out+'/widget-fixture.json',JSON.stringify(report,null,2)+'\n');}
