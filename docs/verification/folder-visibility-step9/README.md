# Step 9 — 통합 회귀와 설치·업그레이드 준비

2026-09-24 로컬 완료. 선행 Step 8의 완료 기록과 소스 SHA-256 142개가 모두 일치함을 확인했다(`prerequisites.json`). 운영 DB/함수/Storage/Pages, .env와 중앙 저장소 소스는 변경하지 않았다.

## 구현

- `setup/setup.mjs folder-visibility` 명령과 `setup/folder-visibility-setup.mjs`: runtime/프로젝트 사전 검사, 관리자 확인, 네 migration의 해시 이력·중단 재시도, member-writing/photo-media 함수 배포와 read smoke probe. 미추적 스키마·해시 불일치·로컬 동시 설치는 중단한다. 기존 회원/방문 secret을 교체하지 않는다.
- 준비 명령은 사진 원본 전환·삭제, ready 활성화, Pages 게시를 하지 않는다. 이미 활성화된 상태에서 재실행하면 기존 mode/ready를 보존한다.
- 실제 중앙 로그인과 서로 다른 A/B origin·개인 DB를 사용하는 기존 세션 통합 harness에 보호된 photo-media를 연결했다. 별도 Step 9 wrapper는 폴더 생성/비공개 글 이동, A 관리자 읽기, A→B 비공개 접근 거절, 비회원·다중 탭 검사까지 실행한다.
- 폴더 회귀 검사의 사진 편집 선택자를 폴더 select로 한정했다. 공개범위 select가 추가되어도 폴더 선택지 검사가 정확하게 동작한다.
- [운영 절차](../../folder-visibility-deployment.md): 신규 설치/기존 업그레이드, 백업·쓰기 동결·파일 복사·원본 폐쇄·활성화 조건, 부분 실패와 복구, A/B 실제 검증 체크리스트.

## 실행 결과

| 로그 | 검사 및 결과 |
| --- | --- |
| install.txt | 실제 install migration loop + 빈 PGlite DB 전체 SQL + 후속 준비 명령 통과. migration 이력 보존, private bucket 생성, ready=false |
| setup.txt | 빈 콘텐츠/기존 데이터의 업그레이드, 관리자 거절, 배포/probe 실패, 재시도, 활성 상태 보존, 해시·미추적 스키마·동시 실행·누락 runtime 거절 통과 |
| integration-1280.txt / integration-375.txt | 실제 중앙 PKCE 로그인 → A 관리 → B 회원 방문, 각 화면 너비 11개 PASS 그룹 |
| folders-ui.txt | 세 메뉴 폴더 CRUD·정렬·글 이동 후 삭제·충돌·응답 유실·인증/메뉴 이탈, 20개 그룹 |
| visibility-concurrency.txt | 실제 PostgreSQL 독립 연결의 공개범위/댓글/권한 해제 경합, 14개 그룹 |
| photo-concurrency.txt | 실제 PostgreSQL의 저장·정리·쓰기 동결·읽기 경합, 4개 그룹 |
| photo-media.txt | 실제 SQL/handler/loopback HTTP와 파일 전환·백업·부분 실패 복구, 11개 그룹 |
| comments.txt / guestbook.txt | 실제 중앙/개인 SQL·handler의 회원 댓글 12개, 방명록 9개 그룹 |
| summary.txt | 공개 홈 집계·글 주소·달력·RLS 8개 그룹 |
| visits.txt | 방문 수·중복/비밀값·권한·실패 복구 10개 그룹 |
| home-setup.txt | 기존 홈 설치·재시도·방문 secret/기존 count 보존 회귀 통과 |
| session-regression.txt | 추가 공개범위 시나리오 없이 기존 A/B 세션 흐름을 최신 사진 스키마/handler로 실행, 9개 그룹 |
| artifact.txt / cli.txt | Pages 빌드·runtime 포함·backend/setup/secret 제외 검사, 새 CLI 명령 표시 통과 |

A/B 통합에서 A의 개인 관리자 권한으로 비공개 직접 주소/이미지 표시를 확인하고, B 방문에서는 A의 중앙 회원 신원만 유지되는 것을 확인했다. B 비공개 전환 뒤 본문·댓글·사진·직접 주소·달력 표시가 차단되고 홈 건수는 공개 글만 센다. 별도 비회원 context와 회원의 다른 탭에서도 차단한다. A의 개인 JWT로 B photo-media를 읽으면 401이다. 재공개 뒤 기존 댓글과 이미지가 복구된다.

기존 세션 시나리오는 네 메뉴 댓글/방명록 작성, 메뉴 이탈 초안 폐기, 20분 비활성 후 자동 갱신, 중앙·개인 서버·네트워크 장애와 공통 재시도, 새 탭/새로고침, 브라우저 저장소 차단과 중앙 절대 만료를 포함한다. 읽기/갱신은 방문 수를 추가로 증가시키지 않는다.

## 재현

Node에서 `scripts/verify-folder-visibility-install.mjs`, `verify-folder-visibility-setup.mjs`를 실행한다. A/B 브라우저 검사는 다음 형식으로 각각 실행한다.

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-folder-visibility-integration.mjs /path/to/playwright/index.mjs 1280
CHROMIUM_PATH=/path/to/chrome node scripts/verify-folder-visibility-integration.mjs /path/to/playwright/index.mjs 375
```

폴더 UI는 verify-content-folders-ui.mjs, 기존 세션은 verify-member-session-integration.mjs에 같은 Playwright 인자를 전달한다. SQL 검사는 각 로그와 같은 이름의 verify 스크립트(visibility-concurrency는 verify-content-visibility-concurrency)를 실행한다. PostgreSQL 경합 검사는 Docker postgres:16-alpine을 사용하고 종료 시 컨테이너를 정리한다. PGlite/pg는 인접 minihompy-central의 기존 dependency를 사용한다.

## 남은 범위

로컬 Auth/Storage 및 SQL HTTP transport는 대역이며 실제 Supabase 서비스나 GitHub Pages를 배포·검증한 결과가 아니다. member comments/guestbook의 과거 스키마 회귀와 신규 photo-media가 적용된 A/B 전체 흐름 검사를 함께 사용했다. 실제 PostgREST/Auth/Edge gateway/Storage/CDN 권한·JWT 만료/로그아웃 시점·이전 URL 폐쇄·파일 hash 보존·최대 파일/동시 읽기와 운영 테스트 정리는 Step 10의 필수 항목이다. 다른 브라우저 엔진은 확인하지 않았다.

`source-hashes.json`은 선행 기반과 이번 단계의 구현·검사·운영 문서 해시다. 기능 전체/일촌 공개는 완료 처리하지 않았다. Step 10은 미착수다.
