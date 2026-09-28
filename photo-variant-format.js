// Shared bounded header inspection. Never decode before this succeeds.
export function inspectImage(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const bad=()=>{throw Error('Unsupported or malformed image');};
 const check=(p,n)=>{if(p<0||p+n>b.length)bad();};
 const u16=(p,le=false)=>{check(p,2);return v.getUint16(p,le);},u32=(p,le=false)=>{check(p,4);return v.getUint32(p,le);};
 const text=(p,n)=>{check(p,n);return String.fromCharCode(...b.subarray(p,p+n));};
 let width,height,mime,orientation=1;
 if(!b.length||b.length>6291456)bad();
 if(b.length>=8&&text(0,8)==='\x89PNG\r\n\x1a\n'){
  mime='image/png';let p=8,header=false,data=false,end=false;
  while(p<b.length){const n=u32(p),kind=text(p+4,4);check(p+8,n+4);
   if(kind==='acTL'||kind==='fcTL'||kind==='fdAT')bad();
   if(!header&&kind!=='IHDR')bad();
   if(kind==='IHDR'){if(header||n!==13)bad();header=true;width=u32(p+8);height=u32(p+12);}
   if(kind==='IDAT')data=true;
   if(kind==='IEND'){if(n!==0||p+12!==b.length)bad();end=true;}
   p+=n+12;
  }
  if(!header||!data||!end)bad();
 }else if(b.length>=12&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
  mime='image/webp';if(u32(4,true)+8!==b.length)bad();let p=12,frames=0,canvas;
  while(p<b.length){const kind=text(p,4),n=u32(p+4,true);check(p+8,n+(n%2));const q=p+8;
   if(kind==='ANIM'||kind==='ANMF')bad();
   if(kind==='VP8X'){if(n!==10||canvas||(b[q]&195)||b[q+1]||b[q+2]||b[q+3])bad();canvas=[1+b[q+4]+(b[q+5]<<8)+(b[q+6]<<16),1+b[q+7]+(b[q+8]<<8)+(b[q+9]<<16)];}
   if(kind==='VP8 '){if(n<10||b[q]&1||text(q+3,3)!=='\x9d\x01\x2a')bad();width=u16(q+6,true)&16383;height=u16(q+8,true)&16383;frames++;}
   if(kind==='VP8L'){if(n<5||b[q]!==47||(b[q+4]&224))bad();const bits=u32(q+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;frames++;}
   p+=8+n+(n%2);
  }
  if(frames!==1||(canvas&&(canvas[0]!==width||canvas[1]!==height)))bad();
 }else if(b.length>=4&&b[0]===255&&b[1]===216){
  mime='image/jpeg';let p=2,frames=0,scan=false;
  while(p<b.length){if(b[p++]!==255)bad();while(b[p]===255)p++;const marker=b[p++];if(marker===217)break;
   const n=u16(p);if(n<2)bad();check(p,n);
   if(marker===226&&n>=6&&text(p+2,4)==='MPF\0')bad();
   if(marker===225&&n>=16&&text(p+2,6)==='Exif\0\0'){
    const t=p+8,le=text(t,2)==='II';if(!le&&text(t,2)!=='MM')bad();if(u16(t+2,le)!==42)bad();const ifd=t+u32(t+4,le);if(ifd<t||ifd+2>p+n)bad();
    const count=u16(ifd,le);if(ifd+2+count*12>p+n)bad();
    for(let i=0;i<count;i++){const a=ifd+2+i*12;if(u16(a,le)===274){if(u16(a+2,le)!==3||u32(a+4,le)!==1)bad();orientation=u16(a+8,le);if(orientation<1||orientation>8)bad();}}
   }
   if([192,193,194].includes(marker)){if(n<8)bad();height=u16(p+3);width=u16(p+5);frames++;}
   else if(marker>=195&&marker<=207&&![196,200,204].includes(marker))bad();
   if(marker===218){scan=true;break;}p+=n;
  }
  if(frames!==1||!scan||b.at(-2)!==255||b.at(-1)!==217)bad();
 }else bad();
 if(!width||!height||width>8192||height>8192||width*height>24000000)bad();
 return {mime,width,height,orientation,displayWidth:orientation>=5?height:width,displayHeight:orientation>=5?width:height};
}
