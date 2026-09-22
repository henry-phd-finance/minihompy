#!/usr/bin/env node
/**
 * 미니홈피 자동 셋업 CLI 도구 (minihompy-setup)
 * 사전 조건: GitHub 계정/저장소 fork, Supabase 계정/프로젝트 생성 완료 후 실행
 * 사용법: 
 *   - npx minihompy-setup [--dry-run]
 *   - node setup/setup.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { Writable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

// ── ANSI 색상 ────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
};
const ok  = (m) => console.log(`${C.green}✓ ${m}${C.reset}`);
const err = (m) => console.log(`${C.red}✗ ${m}${C.reset}`);
const hdr = (m) => console.log(`\n${C.cyan}${C.bold}▶ ${m}${C.reset}`);
const dim = (m) => console.log(`${C.yellow}  ${m}${C.reset}`);

// ── readline 헬퍼 ─────────────────────────────────────────────────────────────
function ask(question) {
  process.stdin.resume();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** 비밀번호/토큰 마스킹 입력 (터미널 노출 완전 차단 및 stdin 스트림 유지) */
function askSecret(question) {
  process.stdin.resume();
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: output,
      terminal: true,
    });

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });

    muted = true;
  });
}

async function askContinue() {
  const a = await ask(`${C.yellow}이 단계를 건너뛰고 계속 진행하시겠습니까? (y/n): ${C.reset}`);
  if (a.toLowerCase() !== 'y') {
    console.log('스크립트를 중단합니다.');
    process.exit(1);
  }
}

// ── API 호출 ──────────────────────────────────────────────────────────────────
async function apiFetch(url, { method = 'GET', token, body } = {}) {
  if (isDryRun) { dim(`[DRY RUN] ${method} ${url}`); return { ok: true, data: {} }; }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.green}━━━ 분산 미니홈피 자동 셋업 (minihompy-setup) ━━━${C.reset}`);
  if (isDryRun) console.log(`${C.yellow}⚠ DRY RUN 모드: 실제 API 호출과 파일 변경 없이 흐름만 확인합니다.${C.reset}`);

  // ── Step 1: 정보 수집 ──────────────────────────────────────────────────────
  hdr('Step 1 / 7  —  설정 정보 입력');
  console.log('  (토큰/비밀번호는 입력 중 화면에 표시되지 않습니다)\n');

  const github = {
    username: (await ask('  GitHub Username: ')).trim(),
    repo:     (await ask('  GitHub 저장소 이름 (fork한 repo, 기본값: minihompy): ')).trim() || 'minihompy',
    pat:      await askSecret('  GitHub Personal Access Token: '),
  };

  const sb = {
    url:     (await ask('  Supabase Project URL (https://xxxx.supabase.co): ')).trim().replace(/\/$/, ''),
    anonKey: await askSecret('  Supabase anon/publishable key: '),
    ref:     (await ask('  Supabase Project Ref (예: itkymmxnbjylyzbmdxdb): ')).trim(),
    token:   await askSecret('  Supabase Management API Access Token: '),
  };

  const admin = {
    email:    (await ask('  관리자 이메일: ')).trim(),
    password: await askSecret('  관리자 비밀번호: '),
  };

  const displayName = (await ask('  미니홈피 표시 이름 (한글 가능): ')).trim();

  const centralEnabled = (await ask('  중앙 연동을 사용하시겠습니까? (y/n): ')).toLowerCase() === 'y';
  let central = { enabled: false, siteId: '', apiUrl: '', pageUrl: '', handle: '' };
  if (centralEnabled) {
    central.apiUrl  = 'https://pcwovvdgggpbghvqraex.supabase.co/functions/v1/identity-api';
    central.pageUrl = 'https://henry-phd-finance.github.io/minihompy-central';
    central.siteId  = 'auto';
    central.handle  = (await ask(`  미니홈피 아이디(Handle) 설정 (기본값: ${github.username.toLowerCase()}): `)).trim().toLowerCase() || github.username.toLowerCase();
    central.enabled = true;
  }

  // ── Step 1.5: 대상 미니홈피 디렉토리 판별 ─────────────────────────────────
  let targetDir = process.cwd();
  if (!fs.existsSync(path.join(targetDir, 'supabase-config.js'))) {
    const scriptParent = path.resolve(__dirname, '..');
    if (fs.existsSync(path.join(scriptParent, 'supabase-config.js'))) {
      targetDir = scriptParent;
    } else {
      console.log(`\n${C.yellow}현재 디렉토리에 미니홈피 프로젝트가 없습니다.${C.reset}`);
      const cloneAnswer = await ask(`  현재 폴더에 저장소(https://github.com/${github.username}/${github.repo})를 클론할까요? (y/n): `);
      if (cloneAnswer.toLowerCase() === 'y') {
        const cloneUrl = `https://${github.username}:${github.pat}@github.com/${github.username}/${github.repo}.git`;
        try {
          execSync(`git clone "${cloneUrl}" "${github.repo}"`, { cwd: targetDir, stdio: 'inherit' });
          targetDir = path.join(targetDir, github.repo);
          ok(`저장소 클론 완료: ${targetDir}`);
        } catch (cloneErr) {
          err(`클론 실패: ${cloneErr.message}`);
          await askContinue();
        }
      }
    }
  }

  // ── Step 2: SQL 마이그레이션 ───────────────────────────────────────────────
  hdr('Step 2 / 7  —  Supabase 마이그레이션 적용');
  let migrDir = path.join(__dirname, '..', 'supabase', 'migrations');
  if (!fs.existsSync(migrDir)) {
    migrDir = path.join(targetDir, 'supabase', 'migrations');
  }

  if (fs.existsSync(migrDir)) {
    const sqlFiles = fs.readdirSync(migrDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of sqlFiles) {
      process.stdout.write(`  ${file} ... `);
      const sql = fs.readFileSync(path.join(migrDir, file), 'utf8');
      const r = await apiFetch(
        `https://api.supabase.com/v1/projects/${sb.ref}/database/query`,
        { method: 'POST', token: sb.token, body: { query: sql } }
      );
      if (r.ok) {
        process.stdout.write(`${C.green}완료${C.reset}\n`);
      } else {
        process.stdout.write(`${C.yellow}경고 (${r.status})${C.reset}\n`);
        dim(`  → ${JSON.stringify(r.data).slice(0, 120)}`);
        dim('  이미 적용된 마이그레이션일 수 있습니다. 계속합니다.');
      }
    }
    ok('마이그레이션 단계 완료');
  } else {
    err(`마이그레이션 폴더를 찾을 수 없습니다: ${migrDir}`);
    await askContinue();
  }

  // ── Step 3: 관리자 계정 생성 ───────────────────────────────────────────────
  hdr('Step 3 / 7  —  관리자 계정 생성');
  let adminUuid = 'dry-run-uuid-0000-0000-0000-000000000000';

  // 1. Fetch Service Role Key using Management API
  let serviceRoleKey = '';
  if (!isDryRun) {
    const keysRes = await apiFetch(`https://api.supabase.com/v1/projects/${sb.ref}/api-keys`, { token: sb.token });
    if (keysRes.ok && Array.isArray(keysRes.data)) {
      const srKeyObj = keysRes.data.find(k => k.name === 'service_role');
      if (srKeyObj) serviceRoleKey = srKeyObj.api_key;
    }
  }

  // 2. Create User using GoTrue Admin API
  let createRes;
  if (isDryRun) {
    createRes = { ok: true, data: { id: adminUuid } };
  } else if (serviceRoleKey) {
    createRes = await apiFetch(
      `https://${sb.ref}.supabase.co/auth/v1/admin/users`,
      { method: 'POST', token: serviceRoleKey, body: { email: admin.email, password: admin.password, email_confirm: true } }
    );
  } else {
    createRes = { ok: false, status: 500, data: { message: 'Service Role Key를 찾을 수 없습니다.' } };
  }
  if (createRes.ok && createRes.data?.id) {
    adminUuid = createRes.data.id;
    ok(`관리자 계정 생성 완료 (UUID: ${adminUuid})`);
  } else {
    err(`관리자 계정 생성 실패 (${createRes.status}): ${JSON.stringify(createRes.data)}`);
    dim('이미 계정이 존재한다면 Supabase 대시보드 Authentication → Users 에서 UUID를 복사해 입력하세요.');
    adminUuid = (await ask('  관리자 User UUID (직접 입력 또는 건너뛰기 Enter): ')).trim();
    if (!adminUuid) await askContinue();
  }

  // ── Step 4: 관리자 UUID 권한 등록 ─────────────────────────────────────────
  if (adminUuid) {
    hdr('Step 4 / 7  —  private.minihompy_admins 권한 등록');
    const adminSql = `INSERT INTO private.minihompy_admins (user_id) VALUES ('${adminUuid}') ON CONFLICT (user_id) DO NOTHING;`;
    const permRes = await apiFetch(
      `https://api.supabase.com/v1/projects/${sb.ref}/database/query`,
      { method: 'POST', token: sb.token, body: { query: adminSql } }
    );
    if (permRes.ok) { ok('관리자 권한 등록 완료'); }
    else {
      err(`권한 등록 실패: ${JSON.stringify(permRes.data)}`);
      await askContinue();
    }
  }

  // ── Step 5: 익명 인증 활성화 ───────────────────────────────────────────────
  hdr('Step 5 / 7  —  익명 인증 활성화');
  const anonRes = await apiFetch(
    `https://api.supabase.com/v1/projects/${sb.ref}/config/auth`,
    { method: 'PATCH', token: sb.token, body: { external_anonymous_users_enabled: true } }
  );
  if (anonRes.ok) { ok('익명 인증 활성화 완료'); }
  else {
    err(`활성화 실패: ${JSON.stringify(anonRes.data).slice(0, 120)}`);
    dim('Supabase 대시보드 Authentication → Providers → Anonymous Sign-ins 에서 수동으로 켜주세요.');
    await askContinue();
  }

  // ── Step 6a: 중앙 siteId 자동 발급 (optional) ─────────────────────────────
  if (central.enabled && central.siteId.toLowerCase() === 'auto') {
    hdr('Step 6a / 7  —  중앙 허브 siteId 오픈 등록 및 자동 발급');
    const regRes = await apiFetch(`${central.apiUrl}/sites`, {
      method: 'POST',
      body: {
        handle: central.handle || github.username.toLowerCase(),
        display_name: displayName || github.username,
        origin: `https://${github.username}.github.io`,
        base_path: `/${github.repo}/`,
        homepage_url: `https://${github.username}.github.io/${github.repo}/`,
        login_url: `https://${github.username}.github.io/${github.repo}/?login_intent=`,
        supabase_project_ref: sb.ref,
      },
    });
    if (regRes.ok && regRes.data?.site_id) {
      central.siteId = regRes.data.site_id;
      ok(`siteId 발급 완료: ${central.siteId}`);
    } else {
      err(`siteId 자동 발급 실패 (${regRes.status}): ${regRes.data?.error || JSON.stringify(regRes.data)}`);
      central.siteId = (await ask('  siteId를 직접 입력하거나 Enter로 건너뛰기: ')).trim();
      if (!central.siteId) { central.enabled = false; dim('중앙 연동을 비활성화합니다.'); }
    }
  }

  // ── Step 6b: 설정 파일 생성 ────────────────────────────────────────────────
  hdr('Step 6 / 7  —  설정 파일 생성');

  const supabaseConfigJs = `// Runtime client connection only. Never put secret/service_role keys in this file.
(() => {
  'use strict';
  window.MINIHOMPY_SUPABASE = Object.freeze({
    url: '${sb.url}',
    publishableKey: '${sb.anonKey}',
  });
})();
`;

  const visitorConfigJs = central.enabled
    ? `(() => {
  'use strict';

  // 중앙 공통 방문자 식별 설정 (Distributed Minihompy Shared Visitor Identity Config)
  window.MINIHOMPY_VISITOR_IDENTITY_CONFIG = Object.freeze({
    enabled: true,

    // 중앙 식별 허브에 등록된 이 미니홈피의 고유 UUID
    siteId: '${central.siteId}',

    // 중앙 식별 서비스 기본 URL
    centralApiUrl: '${central.apiUrl}',
    centralPageUrl: '${central.pageUrl}',

    // 중앙 상태 확인(/health) 타임아웃 제한 (스펙 권장: 1.5초)
    healthTimeoutMs: 1500,

    // 리다이렉트 가드 만료 시간 (2분 = 120,000ms)
    guardTimeoutMs: 120000,
  });
})();
`
    : `(() => {
  'use strict';

  // 중앙 공통 방문자 식별 설정 — 단독 운영 모드 (중앙 연동 비활성)
  window.MINIHOMPY_VISITOR_IDENTITY_CONFIG = Object.freeze({
    enabled: false,
    siteId: '',
    centralApiUrl: '',
    centralPageUrl: '',
    healthTimeoutMs: 1500,
    guardTimeoutMs: 120000,
  });
})();
`;

  if (!isDryRun) {
    fs.writeFileSync(path.join(targetDir, 'supabase-config.js'), supabaseConfigJs);
    ok(`supabase-config.js 작성 완료 (${path.join(targetDir, 'supabase-config.js')})`);
    fs.writeFileSync(path.join(targetDir, 'visitor-identity-config.js'), visitorConfigJs);
    ok(`visitor-identity-config.js 작성 완료 (${path.join(targetDir, 'visitor-identity-config.js')})`);
  } else {
    dim('[DRY RUN] supabase-config.js, visitor-identity-config.js 작성 건너뜀');
  }

  // ── Step 7: Git commit & push ─────────────────────────────────────────────
  hdr('Step 7 / 7  —  Git commit & push');
  if (!isDryRun) {
    try {
      const remote = `https://${github.username}:${github.pat}@github.com/${github.username}/${github.repo}.git`;
      execSync('git add supabase-config.js visitor-identity-config.js', { cwd: targetDir, stdio: 'pipe' });
      execSync('git commit -m "Setup: configure Supabase connection and identity settings"', { cwd: targetDir, stdio: 'pipe' });
      execSync(`git remote set-url origin "${remote}"`, { cwd: targetDir, stdio: 'pipe' });
      execSync('git push origin main', { cwd: targetDir, stdio: 'inherit' });
      // 보안: remote URL을 PAT 없는 버전으로 복원
      execSync(`git remote set-url origin "https://github.com/${github.username}/${github.repo}.git"`, { cwd: targetDir, stdio: 'pipe' });
      ok('Git push 완료 및 remote URL 복원');
    } catch (e) {
      err(`Git 명령 실패: ${e.message}`);
      dim('supabase-config.js 와 visitor-identity-config.js 를 직접 commit & push 해주세요.');
    }
  } else {
    dim('[DRY RUN] git commit & push 건너뜀');
  }

  // ── 완료 요약 ──────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.green}━━━ 셋업 완료 ━━━${C.reset}`);
  console.log(`🌐  미니홈피 URL  : https://${github.username}.github.io/${github.repo}/`);
  console.log(`    (GitHub Actions 배포 완료까지 약 1~3분 소요)`);
  console.log(`🔑  관리자 이메일 : ${admin.email}`);
  console.log(`🔒  관리자 비밀번호: 입력하신 비밀번호를 사용하세요`);
  if (central.enabled) {
    console.log(`🔗  중앙 연동     : 활성 (siteId: ${central.siteId})`);
  } else {
    console.log(`🔗  중앙 연동     : 비활성 (단독 운영 모드)`);
  }
  console.log(`\n${C.bold}${C.yellow}  ⚠ 최초 1회 배포 필수 체크리스트 (Fork 저장소):${C.reset}`);
  console.log(`     1. GitHub 저장소 Settings → Pages 에서`);
  console.log(`        Source를 반드시 ${C.bold}'GitHub Actions'${C.reset}로 선택하세요! (폴더 선택 X)`);
  console.log(`        🔗 https://github.com/${github.username}/${github.repo}/settings/pages`);
  console.log(`     2. Actions 탭으로 이동하여 초록색 버튼 ${C.bold}'Enable workflows'${C.reset}를 클릭하세요.`);
  console.log(`     3. 좌측 'Deploy GitHub Pages' → 우측 ${C.bold}'Run workflow'${C.reset}를 눌러 첫 배포를 실행하세요!`);
  console.log(`        🔗 https://github.com/${github.username}/${github.repo}/actions\n`);
}

main().catch((e) => {
  console.error(`\n${C.red}치명적 오류: ${e.message}${C.reset}`);
  process.exit(1);
});
