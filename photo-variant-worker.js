import {inspectImage} from './photo-variant-format.js';
self.onmessage=async({data})=>{
 let bitmap,canvas;
 try{
  const source=inspectImage(data.bytes),blob=new Blob([data.bytes],{type:source.mime});
  bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
  if(bitmap.width!==source.displayWidth||bitmap.height!==source.displayHeight)throw Error('Orientation mismatch');
  const ratio=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
  canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*ratio)),Math.max(1,Math.round(bitmap.height*ratio)));
  const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw Error('Canvas unavailable');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const out=await canvas.convertToBlob({type:'image/webp',quality:0.82});
  if(out.type!=='image/webp'||!out.size||out.size>=blob.size)throw Error('No savings');
  const bytes=await out.arrayBuffer(),info=inspectImage(bytes);
  if(info.mime!=='image/webp'||info.width!==canvas.width||info.height!==canvas.height)throw Error('Invalid output');
  self.postMessage({bytes},[bytes]);
 }catch{self.postMessage({skip:true});}
 finally{bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}}
};
