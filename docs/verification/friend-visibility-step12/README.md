# 일촌 공개 Step 12 검증

상태: 완료(2026-09-24). 실행 전 Step 11 완료 기록과 기준 파일 583개 해시가 모두 일치했다. 운영 변경 없음. Step 13 미착수.

## 구현

중앙 추적 migration/함수 배포 도구와 개인 `friend-visibility --phase prepare|activate|disable`을 추가했다. 신규 install은 migration 012까지 적용한다. 개인 활성화는 중앙 소유자·사이트 증명, 보호 Storage, 서버 protocol/관리자 조회 및 실제 Pages release·각 파일 해시·사이트 설정을 확인한다. 설치 이력 불일치와 미추적 스키마는 거절한다. Secrets/config 자동 교체나 Pages 게시를 하지 않는다.

DB epoch/transaction으로 오래된 활성화를 막고 disable은 기존 friends 콘텐츠·파일·소유자를 보존한다. [배포·복구 절차](../../friend-visibility-deployment.md)에 비공개 백업, 중앙→A 검증→B, gateway/버전/원본 URL 확인, 실행 journal에 한정한 정리를 기록했다.

## 실행과 결과

아래 명령은 저장소 루트에서 `node scripts/<파일>`로 실행했다. 브라우저 검사는 로컬 Playwright/Chromium과 이 디렉터리의 photos/recovery 출력 경로를 사용했다. 모든 검사 통과.

| 명령 파일 | 검사 | 로그 |
|---|---|---|
| `verify-friend-visibility-setup.mjs` | 개인 준비/활성화/비활성화·재실행 5그룹 | [personal-setup.log](personal-setup.log) |
| `verify-friend-visibility-central-setup.mjs` | 중앙 추적 설치·재실행 2그룹 | [central-setup.log](central-setup.log) |
| `verify-friend-visibility-capability.mjs` | 실제 health handler와 사이트 연결 | [capability.log](capability.log) |
| `verify-friend-visibility-recovery.mjs` | 호환·보존 복구 4검사 | [recovery.log](recovery.log) |
| `verify-friend-visibility-install-concurrency.mjs` | 독립 PostgreSQL 연결 2그룹 | [installation-concurrency.log](installation-concurrency.log) |
| `verify-folder-visibility-install.mjs` | 신규 install 전체 migration | [fresh-install.log](fresh-install.log) |
| `verify-folder-visibility-setup.mjs` | 기존 폴더 설치 3검사 | [folder-setup-regression.log](folder-setup-regression.log) |
| `verify-member-relationship-setup.mjs` | 기존 관계 설치 | [relationship-setup-regression.log](relationship-setup-regression.log) |
| `verify-friend-visibility-api.mjs` | 콘텐츠 API 13그룹 | [content-api.log](content-api.log) |
| `verify-friend-photo-api.mjs` | 사진 API 10그룹 | [photo-api.log](photo-api.log) |
| `verify-friend-photo-http.mjs` | 사진 HTTP 5그룹 | [photo-http.log](photo-http.log) |
| `verify-friend-photos-browser.mjs` | 사진 브라우저 10시나리오 | [photos-regression.log](photos-regression.log) |
| `build-pages.mjs` 후 `verify-artifact.mjs` | runtime 48개 항목, release 해시·비밀/서버 파일 제외 | [artifact.log](artifact.log) |

## 검증 경계와 남은 작업

SQL/권한 및 실제 handler는 PGlite에서, 설치 활성화 경합은 일회용 PostgreSQL 16의 독립 연결에서 검증했다. 브라우저는 실제 view/runtime/repository와 로컬 서버를 사용했다. Auth·중앙 설치 증명·Management API·함수 배포·Pages 제공 및 Storage HTTP는 fixture다. 운영 인증/배포/CDN 검증을 대신하지 않는다. 사진 API는 실제 PNG 바이트를 사용한다.

구 화면은 git HEAD에서 읽은 사진 화면/repository이며 버전은 [기록](recovery/legacy-source.json)에 남겼다. 새 보호 DB/서버에서 friends가 노출되지 않지만 기존 공개 사진도 실패할 수 있어 그 구 화면을 운영 복구안으로 승인하지 않는다. 구 서버 조합은 content health 미지원(404) 대역이며 현재 보호 SQL/photo handler는 유지한다. 보호 스키마를 제거한 과거 서버 전체로의 복구를 검증한 것이 아니다. 비활성화 후 기존 friends rows/assets 보존과 새 friends 쓰기·직접 RLS/옛 댓글 경로 차단을 확인했다.

[Pages release](pages-release.json)는 로컬 빌드의 파일 목록이다. 현재 로컬 회원 작성 설정은 enabled:false로 유지되므로 운영 활성화 가능한 설정이라고 주장하지 않는다. 사이트별 준비·Pages 게시가 별도로 필요하다. health protocol은 함수 bundle 버전 증명이 아니며 버킷 비공개 플래그도 기존 public/signed URL의 CDN 폐쇄 증명이 아니다. 실제 배포 버전·gateway·원본 URL 검증은 Step 13에 남는다.

[결과](results.json), [최종 소스 해시](source-hashes.json). 기존 미커밋 변경과 운영 데이터는 보존했다.
