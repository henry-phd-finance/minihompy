#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { verifyNavigationSetup } from './navigation-setup.mjs';
import { upgradeMemberWriting } from './member-writing-setup.mjs';
import { upgradeFolderVisibility } from './folder-visibility-setup.mjs';
import { upgradeHomeData } from './home-data-setup.mjs';
import { runSetup } from './identity-setup.mjs';

async function secret(question) {
  if(!process.stdin.isTTY)throw Error('비밀 입력에는 TTY 또는 환경변수가 필요합니다.');
  let muted=false;
  const output=new Writable({write(chunk,_encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
  const rl=createInterface({input:process.stdin,output,terminal:true});
  try {const answer=rl.question(question);muted=true;return await answer;} finally{rl.close();process.stdout.write('\n');}
}
const args=process.argv.slice(2);
if(args.includes('--help') || args.length===0) {
  console.log('사용법: node setup/setup.mjs install|register|upgrade|verify|writing|navigation|home-data|folder-visibility --config setup/config.json [--dry-run]\n공개 설정 형식: setup/config.example.json. 비밀: MINIHOMPY_OWNER_EMAIL, MINIHOMPY_OWNER_PASSWORD, SUPABASE_ACCESS_TOKEN (환경변수 또는 마스킹 입력).\n현재 개인 저장소에서 실행합니다. Git commit/push는 직접 실행합니다.');
} else {
  try {
    const command=args.shift(); let configPath, dryRun=false;
    while(args.length){const arg=args.shift();if(arg==='--config')configPath=args.shift();else if(arg==='--dry-run')dryRun=true;else throw Error('알 수 없는 옵션입니다. --help를 확인해 주세요.');}
    if(!configPath)throw Error('--config 파일이 필요합니다.');
    const config=JSON.parse(await readFile(configPath,'utf8'));
    const credentials=(dryRun||command==='navigation')?{}:{email:process.env.MINIHOMPY_OWNER_EMAIL||await secret('소유자 이메일: '),password:process.env.MINIHOMPY_OWNER_PASSWORD||await secret('소유자 비밀번호: '),managementToken:command==='verify'?undefined:process.env.SUPABASE_ACCESS_TOKEN||await secret('Supabase Management access token: ')};
    await (command==='navigation'?verifyNavigationSetup:command==='writing'?upgradeMemberWriting:command==='home-data'?upgradeHomeData:command==='folder-visibility'?upgradeFolderVisibility:runSetup)({config,command,target:process.cwd(),dryRun,...credentials});
  } catch(error){console.error(error.message);process.exitCode=1;}
}
