import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockSettings } from './settings-fixture.mjs';
const { chromium }=await import(pathToFileURL(resolve(process.argv[2])).href);
const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
assert(!/@font-face|Minihompy (Home|Tabs|Extended)|Arial|Georgia|scaleX/.test(css));
const out=new URL('../docs/verification/dotum/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try{
  for(const width of [1000,375]){
    const page=await browser.newPage({viewport:{width,height:812}});await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));await mockSettings(page);
    const requests=[];page.on('request',r=>requests.push(r.url()));
    await page.goto(new URL('../index.html',import.meta.url).href);await page.waitForFunction(()=>window.MinihompySettings.status==='ready');
    await page.evaluate(()=>document.fonts.ready);
    async function inspect(){
      const invalid=await page.locator('body *').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).flatMap(e=>{
        const s=getComputedStyle(e);return !s.fontFamily.startsWith('Dotum')||!['normal','0px'].includes(s.letterSpacing)||s.fontStyle!=='normal'||!['400','700'].includes(s.fontWeight)?[{tag:e.tagName,cls:e.className,font:s.font}]:[];
      }));assert.deepEqual(invalid,[]);
    }
    await inspect();assert.equal(await page.locator('.tab-label').first().evaluate(e=>getComputedStyle(e).transform),'none');
    if(process.argv.includes('--require-dotum')){
      const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
      const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.homepage-title'});
      const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});assert(fonts.some(font=>font.familyName==='Dotum'));
    }
    await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:new URL(`home-${width}.png`,out).pathname});
    await page.locator('#login-auth-toggle').click();await inspect();await page.keyboard.press('Escape');
    await page.locator('[data-menu="profile"]').click();await page.locator('.profile-introduction').waitFor();await inspect();
    assert(!requests.some(url=>/\.woff2(?:\?|$)/.test(url)));
    await page.close();
  }
  console.log('PASS: one Dotum family, regular/bold only, zero added spacing, no text scaling, no Galmuri downloads; desktop/mobile/login/profile. '+(process.argv.includes('--require-dotum')?'Actual Dotum glyph rendering confirmed.':'System fallback allowed.'));
}finally{await browser.close();}
