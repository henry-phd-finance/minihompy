// Actual browser repository/media/view, deterministic route latency and byte delay; no hosted data.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const out=process.env.VERIFICATION_DIR||'/tmp/photo-display';await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
const hash=b=>createHash('sha256').update(b).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const files=['photos-repository.js','photo-media-client.js','views/photos.js','photo-variant-client.js','photo-variant-worker.js','photo-variant-format.js'];
try{
 const generate=await browser.newPage();await generate.route('**/*',async route=>{const name=new URL(route.request().url()).pathname.slice(1);return route.fulfill({contentType:name?'text/javascript':'text/html',body:name?await readFile(name,'utf8'):'<script src="/photo-variant-client.js"></script>'});});
 await generate.goto('https://fixture.test/');
 const inputs=await generate.evaluate(async()=>{
  const make=async(name,w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d'),d=x.createImageData(w,h);let seed=42;
   for(let i=0;i<d.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;d.data[i]=seed&255;d.data[i+1]=(seed>>>8)&255;d.data[i+2]=(seed>>>16)&255;d.data[i+3]=i<4*w*20?0:255;}x.putImageData(d,0,0);
   const b=await new Promise(r=>c.toBlob(r,'image/png')),v=await MinihompyPhotoVariant.convert(b);return {name,width:w,height:h,type:b.type,source:[...new Uint8Array(await b.arrayBuffer())],variant:v?[...new Uint8Array(await v.arrayBuffer())]:null};};
  return [await make('large-alpha-detail',1600,1000),await make('small-alpha',8,8)];
 });
 await generate.close();
 inputs.push({name:'gif',width:2,height:2,type:'image/gif',source:[...Buffer.from('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBCgABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7','base64')],variant:null});
 const results=[];
 for(const input of inputs){const original=Buffer.from(input.source),variant=input.variant&&Buffer.from(input.variant);assert(original.length<=6*1024*1024);
  for(const useVariant of [false,true])for(let sample=0;sample<(input.name.startsWith('large')?3:1);sample++){
   const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],reads=[];let checks=0;page.on('pageerror',e=>errors.push(e.message));
   const scale=Math.min(1,1200/Math.max(input.width,input.height));
   const descriptor={post_id:'p',path:'p/image',revision:1,source_sha256:hash(original),representation:variant?{kind:'display-v1',sha256:hash(variant),width:Math.round(input.width*scale),height:Math.round(input.height*scale),size:variant.length}:null};
   await page.route('**/*',async route=>{const name=new URL(route.request().url()).pathname.slice(1);
    if(files.includes(name)||name==='styles.css')return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:await readFile(name,'utf8')});
    if(name==='check'){checks++;const body=route.request().postDataJSON();await delay(30);return route.fulfill({json:{items:[{id:'p',valid:true,...(body.variant?{photos:[descriptor]}:{})}]}});}
    if(name.endsWith('/photo-media/read')){const body=route.request().postDataJSON(),bytes=body.representation?variant:original;assert(bytes);reads.push({variant:!!body.representation,bytes:bytes.length});await delay(30+bytes.length/(2*1024*1024)*1000);return route.fulfill({contentType:body.representation?'image/webp':input.type,body:bytes});}
    assert.equal(name,'');return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>#main{width:800px;position:relative}.photos-scroll{height:800px;overflow:auto}</style><div id="left"></div><div id="main"></div><script>
    window.MinihompyComments={create:()=>document.createElement('div'),clearKind:()=>{},forget:()=>{}};window.MINIHOMPY_VIEWS={};window.MINIHOMPY_CONFIG={profile:{name:'Fixture'}};window.MINIHOMPY_SUPABASE={url:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',publishableKey:'fixture'};window.MinihompyAdmin={state:{role:'visitor'}};window.MinihompyPhotoEditor={active:false,busy:false};
    const post={id:'p',revision:1,folder_id:'f',title:'사진',author_name:'Fixture',visibility:'public',created_at:'2026-09-28T00:00:00Z',body:[{type:'text',text:'본문 우선'},{type:'image',path:'p/image'}]};
    const client={from:()=>({select:()=>({order:()=>({order:async()=>({data:[{id:'f',kind:'folder',label:'사진'}]})})})})};
    window.MinihompyContentAccess={open:async()=>({client,assert:()=>{},verify:async()=>{},authorization:async()=>null}),read:async(action,body)=>{
     if(action==='readiness')return {capabilities:{photo_check_protocol:1,${useVariant?'photo_variant_read_protocol:1':''}}};
     if(action==='list')return {data:{items:[post],count:1}};
     if(action==='photo-check')return {data:await(await fetch('/check',{method:'POST',body:JSON.stringify(body)})).json()};
     if(action==='photo')return {response:await fetch(MINIHOMPY_SUPABASE.url+'/functions/v1/photo-media/read',{method:'POST',body:JSON.stringify(body)}),verify:async()=>{}};
    }};window.created=[];window.revoked=[];const make=URL.createObjectURL.bind(URL),drop=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=make(b);created.push(u);return u;};URL.revokeObjectURL=u=>{revoked.push(u);drop(u);};
    </script>${files.slice(0,3).map(f=>'<script src="/'+f+'"></script>').join('')}<script>
    const start=performance.now();window.timing={};new MutationObserver(()=>{if(!timing.text&&document.querySelector('.photo-post'))timing.text=performance.now()-start;if(!timing.image&&document.querySelector('.photo-image-slot[data-state=ready]'))timing.image=performance.now()-start;}).observe(document.querySelector('#main'),{childList:true,subtree:true,attributes:true});
    document.querySelector('#left').append(MINIHOMPY_VIEWS.photos.createLeft());document.querySelector('#main').append(MINIHOMPY_VIEWS.photos.createMain());</script>`});
   });
   await page.goto('https://fixture.test/');await page.waitForFunction(()=>timing.image>0).catch(async e=>{console.log({input:input.name,useVariant,errors,reads,checks,text:await page.locator('body').innerText()});throw e;});
   const observed=await page.evaluate(()=>{const img=document.querySelector('.photo-image'),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return {...timing,width:img.naturalWidth,height:img.naturalHeight,alpha:x.getImageData(0,0,1,1).data[3],cssWidth:img.getBoundingClientRect().width};});
   assert.equal(reads.length,1);assert.equal(reads[0].variant,!!(useVariant&&variant));assert.equal(checks,useVariant?2:1);assert(observed.text<observed.image);
   assert.equal(observed.width,useVariant&&variant?descriptor.representation.width:input.width);assert.equal(observed.height,useVariant&&variant?descriptor.representation.height:input.height);assert.equal(observed.alpha,input.name==='gif'?255:0);
   if(input.name==='gif'){
    const frames=new Set();for(let i=0;i<10;i++){frames.add(hash(await page.locator('.photo-image').screenshot()));await delay(35);}assert.equal(frames.size,2);observed.animationFrames=frames.size;
   }
   await page.evaluate(()=>{document.querySelector('#main').replaceChildren();dispatchEvent(new Event('minihompy:content-access-reset'));});assert.equal(await page.evaluate(()=>created.filter(u=>!revoked.includes(u)).length),0);assert.deepEqual(errors,[]);
   results.push({input:input.name,useVariant,sample,...observed,checks,reads,sourceBytes:original.length});await page.close();
  }
 }
 const large=results.filter(r=>r.input.startsWith('large')),median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
 const before=median(large.filter(r=>!r.useVariant).map(r=>r.image)),after=median(large.filter(r=>r.useVariant).map(r=>r.image));assert(after<before);
 const report={conditions:{bandwidthBytesPerSecond:2*1024*1024,requestDelayMs:30,largeSamplesPerMode:3,cache:'new page, no media reuse',note:'Browser routes model byte transfer delay; timings are fixture measurements, not hosted network results. One page-level selection request is added only with read capability. No client conversion or second media download.'},beforeMedianMs:before,afterMedianMs:after,results};
 await writeFile(out+'/display-metrics.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({beforeMedianMs:before,afterMedianMs:after,originalBytes:large[0].sourceBytes,variantBytes:large.find(r=>r.useVariant).reads[0].bytes}));console.log('PASS actual view/media/Worker: large transfer and first image improvement, dimensions/alpha, one media request, small/GIF original compatibility and Blob reset');
}finally{await browser.close();}
