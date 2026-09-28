// Local public/synthetic pixels only. This is a conversion study, not the production encoder.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const out=process.env.VERIFICATION_DIR||'docs/verification/additional-performance-step1';await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.argv[2]))),browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const sources=await Promise.all(['forest','lake'].map(async name=>({name,data:(await readFile('assets/photos/'+name+'.jpg')).toString('base64')})));
try{const page=await browser.newPage();const report=await page.evaluate(async sources=>{
 const rows=[],inputs=[],blobOf=(c,type,q)=>new Promise(r=>c.toBlob(r,type,q));
 for(const s of sources){const b=await(await fetch('data:image/jpeg;base64,'+s.data)).blob();inputs.push({name:s.name,blob:b});}
 // A small transparent input and a deterministic large, detailed input exercise both byte outcomes.
 const small=document.createElement('canvas');small.width=small.height=32;small.getContext('2d').fillRect(8,8,16,16);inputs.push({name:'small-alpha',blob:await blobOf(small,'image/png')});
 const large=document.createElement('canvas');large.width=4000;large.height=3000;const ctx=large.getContext('2d'),im=ctx.createImageData(4000,3000);let seed=42;
 for(let i=0;i<im.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;im.data[i]=seed&255;im.data[i+1]=(seed>>>8)&255;im.data[i+2]=(seed>>>16)&255;im.data[i+3]=255;}ctx.putImageData(im,0,0);inputs.push({name:'large-detail-12mp',blob:await blobOf(large,'image/jpeg',.50)});large.width=large.height=1;
 for(const input of inputs){for(const q of [.75,.82,.90]){const t=performance.now(),bitmap=await createImageBitmap(input.blob,{imageOrientation:'from-image'}),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));const x=c.getContext('2d');x.drawImage(bitmap,0,0,c.width,c.height);const original=x.getImageData(0,0,c.width,c.height).data,b=await blobOf(c,'image/webp',q),decoded=await createImageBitmap(b);x.clearRect(0,0,c.width,c.height);x.drawImage(decoded,0,0);const after=x.getImageData(0,0,c.width,c.height).data;let mse=0,alphaMax=0;for(let i=0;i<original.length;i++){if(i%4===3)alphaMax=Math.max(alphaMax,Math.abs(original[i]-after[i]));else mse+=(original[i]-after[i])**2;}mse/=original.length*.75;
 if(['forest','lake'].includes(input.name)){const img=document.createElement('img');img.src=URL.createObjectURL(b);img.width=400;const label=document.createElement('p');label.textContent=input.name+' WebP '+q;document.body.append(label,img);}
 rows.push({name:input.name,sourceWidth:bitmap.width,sourceHeight:bitmap.height,sourceBytes:input.blob.size,width:c.width,height:c.height,quality:q,mime:b.type,bytes:b.size,savingPercent:Math.round((1-b.size/input.blob.size)*10000)/100,encodeAndDecodeMs:Math.round(performance.now()-t),psnrRgb:mse?Math.round(10*Math.log10(255**2/mse)*100)/100:null,alphaMaxError:alphaMax,keep:b.size<input.blob.size});bitmap.close();decoded.close();c.width=c.height=1;}}
 const largeInput=inputs.find(i=>i.name==='large-detail-12mp');const largeBase64=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(largeInput.blob);});return {largeBase64,browser:navigator.userAgent,rows,notes:['Deterministic synthetic detail is not a natural-photo quality benchmark.','PSNR compares to canvas downscaled pixels, not full-resolution original; not a visual acceptance threshold.','No implementation or production image is changed.']};
 },sources);
 if(process.env.FIXTURE_LARGE_PHOTO_PATH)await writeFile(process.env.FIXTURE_LARGE_PHOTO_PATH,Buffer.from(report.largeBase64,'base64'));delete report.largeBase64;
 assert(report.rows.every(r=>r.sourceBytes<=6*1024*1024));
 assert(report.rows.every(r=>r.mime==='image/webp'&&Math.max(r.width,r.height)<=1200));assert(report.rows.filter(r=>r.name==='small-alpha').every(r=>r.alphaMaxError===0));
 await page.screenshot({path:'/tmp/additional-photo-quality.png',fullPage:true});
 await writeFile(out+'/photo-fixture.json',JSON.stringify(report,null,2)+'\n');console.log('PASS 12 local conversion samples; dimension and alpha checks');
}finally{await browser.close();}
