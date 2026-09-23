import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mockSettings } from './settings-fixture.mjs';
const { chromium }=await import(pathToFileURL(resolve(process.argv[2])).href);
const out=new URL('../docs/verification/scale/',import.meta.url); await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try {
  const page=await browser.newPage(); await page.addInitScript(()=>Object.defineProperty(window,'MINIHOMPY_VISITOR_IDENTITY_CONFIG',{get:()=>({enabled:false}),set:()=>{}}));await mockSettings(page);
  await page.goto(new URL('../index.html',import.meta.url).href);
  await page.waitForFunction(()=>window.MinihompySettings.status==='ready');
  for(const [width,height,scale] of [[1280,812,1.875],[375,812,1],[1124,812,1],[1125,699,1],[1125,700,1.875]]){
    await page.setViewportSize({width,height}); await page.evaluate(()=>document.fonts.ready);
    const box=await page.locator('.minihompy').boundingBox();
    assert.equal(box.width,579*scale); assert.equal(box.height,349*scale);
    assert.equal(await page.locator('.minihompy').evaluate(e=>e.offsetWidth),579);
    await page.locator('#login-auth-toggle').click();
    assert.equal((await page.locator('.login-dialog').boundingBox()).width,270);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:new URL(`${width}-${height}.png`,out).pathname});
  }
  console.log('PASS: uniform 1.875x desktop geometry, 1x small viewport, resize breakpoints, independent login dialog, unchanged internal width.');
}finally{await browser.close();}
