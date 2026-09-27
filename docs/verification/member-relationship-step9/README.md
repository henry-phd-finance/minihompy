# 관계 Step 9 — 설치·업그레이드·배포 준비

2026-09-24 로컬 완료. 착수 전 Step 8 소스/근거 SHA256 301개가 모두 일치함을 확인했다. 운영 중앙/A/B SQL·함수·Secrets·Pages는 변경하지 않았다. Step 10 미착수.

## 변경

- 중앙 `deploy-member-relationships.mjs`: 기존 세션 기반 검사, 관계 SQL SHA256 추적, 함수 배포, protocol health, Secrets 유지. 신규 중앙은 기존 migrations를 004까지 적용한 뒤 같은 명령으로 관계 SQL을 설치한다.
- 개인 `setup/setup.mjs relationships`: Pages 모듈 확인, 실행 잠금, 중앙 protocol 확인, 기존 소유자/중앙 연결 검증 재사용, 세션·일촌평 SQL 추적, 단일 함수 배포, 실제 개인 health 및 세션 probe 이후 활성화. 새 install의 전체 migration 이력과 호환한다.
- [운영 적용·복구·검증/정리 절차](../../member-relationship-deployment.md): 중앙→A 서버/Pages/검증→B, 불변 복구 묶음, 기존 관계/평 보존, hosted peer·공유 rate bucket·PostgREST timeout 확인.

## 검사와 명령

저장소 루트에서 실행했다. 모든 최종 로그는 PASS다.

| 명령 | 결과/증거 |
| --- | --- |
| `node scripts/verify-member-relationship-install.mjs` | [install.log](install.log): 실제 중앙 기반 SQL→새 관계 설치, 배포 실패·health 실패 후 재실행, 기존 회원/새 관계 보존, hash/미추적 차단. 실제 개인 신규 installer 전체 SQL 적용, Auth 경계 중단 뒤 재실행, tracked schema 재사용, RPC timeout 선언 |
| `node scripts/verify-member-relationship-setup.mjs` | [upgrade.log](upgrade.log): 실제 기존 개인 DB 업그레이드·글/평 보존, 실제 개인 handler health, 구 중앙 차단, probe 실패 시 활성화 파일 보존, 재실행·해시/미추적 차단·실행 잠금/정리·dry run |
| `node scripts/verify-member-writing-setup.mjs` | [writing-setup.log](writing-setup.log): 기존 회원 작성 설치 회귀 |
| `node ../minihompy-central/scripts/verify-member-sessions.mjs` | [central-sessions.log](central-sessions.log): 새 중앙 DB/API의 기존 세션 protocol 2 계약 12개 그룹 |
| `node scripts/verify-member-relationship-api.mjs` | [api.log](api.log): 실제 중앙·개인 handler/SQL 12개 그룹, 구 개인 DB에서 일촌평 미준비 및 기존 세션 경로 |
| `node scripts/verify-member-relationship-client.mjs` | [client.log](client.log): 공통 client/runtime/repository 5개 그룹 |
| `node scripts/verify-friend-reviews.mjs` | [reviews.log](reviews.log): 실제 일촌평 handler/SQL 13개 그룹 |
| `CHROMIUM_PATH=… MINIHOMPY_RELATIONSHIP_UI_OUTPUT=docs/verification/member-relationship-step9/ui node scripts/verify-member-relationship-ui.mjs /home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs` | [ui.log](ui.log): 1280/375px 총 12개 그룹, 서버 미준비/복구·오류 표시 포함 |
| `node scripts/build-pages.mjs` 및 `node scripts/verify-artifact.mjs` | [artifact.log](artifact.log): 관계·일촌평 모듈 포함, 로컬 링크와 backend/setup/비밀 제외 |

구문 검사, 두 저장소 `git diff --check`, 문서 상대 링크 검사도 통과했다. Chromium은 `/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`을 사용했다.

## 검증 범위와 초기 실패

PGlite에서는 실제 migration/handler를 실행했고 관리 API·Auth·CLI 배포는 fixture다. 신규 개인 검사는 실제 installer의 모든 SQL과 재실행을 수행한 뒤 의도적으로 Auth 경계에서 중단한다. 등록·실제 로그인·외부 배포까지 신규 설치했다고 주장하지 않는다. 중앙 기반은 실제 선행 migrations로 구성했다.

초기 신규 설치 테스트는 Auth fixture 예외 원문을 기대했으나 production request가 이를 일반 연결 실패로 정리하여 assertion이 실패했다([install-initial.log](install-initial.log)). 테스트를 실제 Auth 경계 도달 횟수와 공개 오류를 확인하도록 수정했다. 실제 SQL 실패가 아니며 최종 재검증 통과. 개인 health probe는 실제 handler로 검증하도록 보강했고 필수 `X-Minihompy-Auth-Mode: public`을 명시했다.

hosted peer 주소/게이트웨이 bucket과 hosted PostgREST의 실제 실행 timeout은 운영 환경에서 아직 입증하지 않았다. Step 10의 격리 진단과 완료 조건으로 남긴다. 운영 기능 확인·기존 A/B 데이터 보존·정리까지 완료하기 전 백로그 기능 체크박스를 완료 처리하지 않는다.
