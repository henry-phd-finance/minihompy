// Run from cyworld. Set PLAYWRIGHT_PATH and optionally CHROMIUM_PATH.
// Arguments select groups (db/api/browser/regression/integration) or individual suite names.
// Example: node scripts/verify-friend-visibility-suite.mjs db integration
import {spawn} from 'node:child_process';
import {mkdir,writeFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
const suites=[
  {
    "name": "central-verify-friend-visibility-concurrency",
    "script": "../minihompy-central/scripts/verify-friend-visibility-concurrency.mjs",
    "args": [],
    "env": {},
    "group": "db"
  },
  {
    "name": "verify-friend-visibility-db-concurrency",
    "script": "scripts/verify-friend-visibility-db-concurrency.mjs",
    "args": [],
    "env": {},
    "group": "db"
  },
  {
    "name": "verify-friend-comments-concurrency",
    "script": "scripts/verify-friend-comments-concurrency.mjs",
    "args": [],
    "env": {},
    "group": "db"
  },
  {
    "name": "verify-friend-photo-concurrency",
    "script": "scripts/verify-friend-photo-concurrency.mjs",
    "args": [],
    "env": {},
    "group": "db"
  },
  {
    "name": "central-verify-friend-visibility",
    "script": "../minihompy-central/scripts/verify-friend-visibility.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-visibility-api",
    "script": "scripts/verify-friend-visibility-api.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-visibility-http",
    "script": "scripts/verify-friend-visibility-http.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-comments-api",
    "script": "scripts/verify-friend-comments-api.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-photo-api",
    "script": "scripts/verify-friend-photo-api.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-photo-http",
    "script": "scripts/verify-friend-photo-http.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-aggregates-api",
    "script": "scripts/verify-friend-aggregates-api.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-aggregates-db",
    "script": "scripts/verify-friend-aggregates-db.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-diary-filters",
    "script": "scripts/verify-friend-diary-filters.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-read-renewal",
    "script": "scripts/verify-friend-read-renewal.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-photo-client",
    "script": "scripts/verify-friend-photo-client.mjs",
    "args": [],
    "env": {},
    "group": "api"
  },
  {
    "name": "verify-friend-home-browser",
    "script": "scripts/verify-friend-home-browser.mjs",
    "args": [
      "$PLAYWRIGHT"
    ],
    "env": {
      "VERIFICATION_DIR": "$OUTPUT/home"
    },
    "group": "browser"
  },
  {
    "name": "verify-friend-menus-browser",
    "script": "scripts/verify-friend-menus-browser.mjs",
    "args": [
      "$PLAYWRIGHT"
    ],
    "env": {
      "VERIFICATION_DIR": "$OUTPUT/menus"
    },
    "group": "browser"
  },
  {
    "name": "verify-friend-photos-browser",
    "script": "scripts/verify-friend-photos-browser.mjs",
    "args": [
      "$PLAYWRIGHT"
    ],
    "env": {
      "VERIFICATION_DIR": "$OUTPUT/photos"
    },
    "group": "browser"
  },
  {
    "name": "verify-member-relationship-integration",
    "script": "scripts/verify-member-relationship-integration.mjs",
    "args": [
      "$PLAYWRIGHT"
    ],
    "env": {
      "VERIFICATION_DIR": "$OUTPUT/relationships",
      "MINIHOMPY_TEST_FRIEND_VISIBILITY": "1",
      "MINIHOMPY_TEST_PHOTO_MEDIA": "1"
    },
    "group": "browser"
  },
  {
    "name": "verify-member-session-integration",
    "script": "scripts/verify-member-session-integration.mjs",
    "args": [
      "$PLAYWRIGHT",
      "1280"
    ],
    "env": {
      "MINIHOMPY_TEST_FRIEND_VISIBILITY": "1",
      "MINIHOMPY_SESSION_INTEGRATION_OUTPUT": "$OUTPUT/sessions"
    },
    "group": "browser"
  },
  {
    "name": "verify-navigation-integration",
    "script": "scripts/verify-navigation-integration.mjs",
    "args": [
      "$PLAYWRIGHT",
      "1280"
    ],
    "env": {},
    "group": "browser"
  },
  {
    "name": "verify-member-comments",
    "script": "scripts/verify-member-comments.mjs",
    "args": [],
    "env": {
      "MINIHOMPY_TEST_FRIEND_VISIBILITY": "1",
      "MINIHOMPY_TEST_PHOTO_MEDIA": "1"
    },
    "group": "regression"
  },
  {
    "name": "verify-member-guestbook",
    "script": "scripts/verify-member-guestbook.mjs",
    "args": [],
    "env": {
      "MINIHOMPY_TEST_FRIEND_VISIBILITY": "1",
      "MINIHOMPY_TEST_PHOTO_MEDIA": "1"
    },
    "group": "regression"
  },
  {
    "name": "verify-friend-reviews",
    "script": "scripts/verify-friend-reviews.mjs",
    "args": [],
    "env": {
      "MINIHOMPY_TEST_FRIEND_VISIBILITY": "1",
      "MINIHOMPY_TEST_PHOTO_MEDIA": "1"
    },
    "group": "regression"
  },
  {
    "name": "verify-photo-media",
    "script": "scripts/verify-photo-media.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-home-summary",
    "script": "scripts/verify-home-summary.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-visit-counts",
    "script": "scripts/verify-visit-counts.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-post-location",
    "script": "scripts/verify-post-location.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-member-session-runtime",
    "script": "scripts/verify-member-session-runtime.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-member-session-client",
    "script": "scripts/verify-member-session-client.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-content-access",
    "script": "scripts/verify-content-access.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-friend-content-access",
    "script": "scripts/verify-friend-content-access.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-member-navigation-state",
    "script": "scripts/verify-member-navigation-state.mjs",
    "args": [],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-author-navigation",
    "script": "scripts/verify-author-navigation.mjs",
    "args": [
      "$PLAYWRIGHT"
    ],
    "env": {},
    "group": "regression"
  },
  {
    "name": "verify-surf-navigation",
    "script": "scripts/verify-surf-navigation.mjs",
    "args": [
      "$PLAYWRIGHT"
    ],
    "env": {
      "VERIFICATION_DIR": "$OUTPUT/surf"
    },
    "group": "regression"
  },
  {
    "name": "cross-surface",
    "script": "scripts/verify-friend-visibility-integration.mjs",
    "args": [],
    "env": {},
    "group": "integration"
  },
  {
    "name": "navigation-visits-mobile",
    "script": "scripts/verify-navigation-integration.mjs",
    "args": [
      "$PLAYWRIGHT",
      "375"
    ],
    "env": {
      "HOME_VISITS_INTEGRATION": "1",
      "MINIHOMPY_TEST_FRIEND_VISIBILITY": "1",
      "MINIHOMPY_TEST_PHOTO_MEDIA": "1"
    },
    "group": "integration"
  }
];
const selected=process.argv.slice(2),out=resolve(process.env.VERIFICATION_DIR||'docs/verification/friend-visibility-step11');
if(selected.some(s=>!suites.some(x=>x.name===s||x.group===s)))throw Error('Unknown suite/group');
const jobs=suites.filter(s=>!selected.length||selected.includes(s.name)||selected.includes(s.group));
if(jobs.some(s=>s.args.includes('$PLAYWRIGHT'))&&!process.env.PLAYWRIGHT_PATH)throw Error('Set PLAYWRIGHT_PATH to the Playwright module path');
await mkdir(out,{recursive:true});const results=[];
for(const job of jobs){
 const args=job.args.map(s=>s==='$PLAYWRIGHT'?process.env.PLAYWRIGHT_PATH:s);
 const env=Object.fromEntries(Object.entries(job.env).map(([k,v])=>[k,v.replace('$OUTPUT',out)]));
 const file=await open(resolve(out,job.name+'.log'),'w'),start=performance.now();let result;
 try{result=await new Promise((done,reject)=>{
  const child=spawn(process.execPath,[job.script,...args],{env:{...process.env,...env},stdio:['ignore',file.fd,file.fd]});
  child.once('error',reject);child.once('exit',(code,signal)=>done({exit_code:code,signal}));
 });}finally{await file.close();}
 results.push({...job,args,env,...result,elapsed_seconds:Math.round((performance.now()-start)/10)/100});
 await writeFile(resolve(out,'suite-run.json'),JSON.stringify(results,null,2)+'\n');
 console.log(job.name+': '+(result.exit_code===0?'PASS':'FAIL'));
}
if(results.some(r=>r.exit_code!==0))process.exitCode=1;
