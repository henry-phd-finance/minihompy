import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateConfig,request} from './identity-setup.mjs';
export async function verifyNavigationSetup({config,target,dryRun=false,fetcher=fetch,log=console.log}){
 const c=validateConfig(config);
 if(!c.siteId)throw Error('중앙 등록 siteId가 필요합니다.');
 const html=await readFile(join(target,'index.html'),'utf8');
 for(const file of ['member-navigation.js','author-navigation.js','surf-navigation.js']){
  await readFile(join(target,file));if(!html.includes(`src="${file}"`))throw Error('이동 런타임 연결이 필요합니다: '+file);
 }
 if(dryRun){log('DRY RUN: 이동 런타임 확인 완료. 중앙 SQL/함수 배포 후 공개 API를 확인합니다.');return;}
 const health=await request(c.centralApiUrl+'/health',{},fetcher);if(health.navigation_protocol!==1)throw Error('중앙 이동 서버를 먼저 배포해 주세요.');
 const result=await request(c.centralApiUrl+'/navigation/site?site_id='+encodeURIComponent(c.siteId),{},fetcher);
 if(result.item?.site_id!==c.siteId||(result.item.homepage_url||'').replace(/\/$/,'')!==c.homepage.replace(/\/$/,''))throw Error('중앙 등록 홈페이지가 현재 사이트와 다릅니다.');
 await request(c.centralApiUrl+'/directory?limit=1',{},fetcher);
 log('이동 기능 준비 완료. 기존 개인 설정을 유지한 채 Pages 런타임을 배포하세요. 개인 DB 변경은 없습니다.');
}
