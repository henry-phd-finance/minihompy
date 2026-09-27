# Step 10 — A/B 운영 적용과 실제 계정 검증

2026-09-24 완료. A/B 실제 검증·테스트 정리·기존 데이터 보존을 마쳤다. Step 9의 완료 기록과 소스 해시 151개가 일치함을 먼저 확인했다. A/B를 별도 checkout으로 배포했고 개인 config·프로젝트·중앙 siteId·소유권 파일을 보존했다. 중앙 서버 코드는 변경하지 않았다.

## 적용 내용

- 개인 DB migrations 202609240001~005, member-writing/photo-media Edge, 전체 Pages runtime.
- 기존 파일을 백업한 뒤 inventory 동결 → copy/해시 확인 → protect → Pages 표시 확인 → close-legacy → 실제 접근 차단 검사 → ready 활성화 순서.
- A 기존 사진 1개(20,038바이트), B 기존 사진 0개. 옛 bucket은 private로 바꾸고 원본을 Storage API로 정리했다. 새로운 private bucket의 바이트는 백업 SHA-256과 대조했다.
- 비공개 백업: `~/.local/state/minihompy-deployment/folder-visibility-20260924/`. 각 사이트 57개 public/private/auth/storage 테이블 데이터와 columns/constraints/indexes/policies/triggers/grants/함수 정의, 기존 함수 버전, 모든 Storage 원본 바이트를 보관했다. 데이터·파일·자격 증명은 공개 저장소에 넣지 않았다.

## 실제 환경에서 발견한 보완

1. Supabase safeupdate가 WHERE 없는 상태 변경을 거절했다. 아직 파일 전환 전인 legacy/ready=false에서 중단됐으며 원본은 유지됐다. 이미 적용된 004를 수정하지 않고 `202609240005_photo_media_safeupdate.sql`로 singleton 조건을 추가했다. fresh install·추적 upgrade·실패/재시도 및 사진 SQL/handler 11개 그룹을 재검증했고 실제 freeze/protect도 통과했다.
2. 초기 개인 관리자 확인이 늦어지면 진행 중인 회원 증명 교환의 인증 세대가 바뀌는 경합을 재현했다. visitor-identity가 관리자 refresh를 기다린 뒤 회원 증명을 교환하도록 수정했다. 기다리는 동안 로그아웃하면 방문 세대 검사로 중단한다. 수정 전 재현 실패는 startup-before.txt, 수정 후 두 검사와 세션 runtime 회귀는 startup-fix.txt/session-runtime.txt, A/B 로컬 통합 회귀는 integration-fix.txt다. 최종 Pages에 보완을 포함했다.

## 검증 기록

| 기록 | 범위 |
| --- | --- |
| prerequisites.json / preflight.json / backups.json | 선행 소스 확인, A/B GitHub·Management 권한, 관리자/백업 확인 |
| storage-preflight.json | 임시 실제 private 버킷의 public/authenticated download·sign·transform·list 익명 차단과 정리 |
| A-server.json / B-server.json | 함수 버전과 서버 준비 상태 |
| *-media-*.json / *-activation.json | 전환 journal 단계, 기존 공개 URL 차단, private 직접 접근/서명/목록 차단, 보호 활성화 |
| A-release.json / B-release.json | 최종 GitHub commit과 성공한 Pages Actions URL |
| A-artifacts.json / B-artifacts.json | 사이트별 배포 runtime 50개 파일의 제공 바이트 SHA-256 대조 |
| A-live.json / A-validation.json / A-cleanup-recovery.json | 실제 A 관리/비회원 모바일 읽기/비공개 전환/이동/댓글/로그아웃/재로그인/사진 편집. 최초 브라우저 정리 실패 후 journal ID만으로 REST 정리 복구 |
| B-live.json | 실제 B 관리와 A→B 회원 방문·댓글·비공개 접근/탭/직접 주소·모바일 재로그인/사진 편집 |
| A-media-live.json / B-media-live.json | 실제 6 MiB 업로드·동일 경로 재시도·동시 4개 바이트 조회·SHA-256·no-store, staged 익명 차단, 다른 프로젝트/잘못된 JWT 거절, 로그아웃한 기존 JWT 401, 정리 후 404 |
| A-resilience.json | 실제 서버에 저장된 뒤 업로드/게시물 응답만 유실시켜 같은 path/ID로 복구. 이미지 통신 오류와 UI 재조회 복구, 테스트 정리 |
| preservation.json | A/B 기존 public 데이터·관리자/사이트 연결·원본 파일 hash 보존, 테스트 게시물/댓글/폴더/실제 파일 제거 확인 |

A 최초 브라우저 정리 실패는 기능 검사의 성공과 구분해 A-live.json에 남겼다. REST로 기록된 ID만 정리하고 기존 데이터 보존을 확인한 결과는 A-validation.json이다. 응답 유실 검사의 첫 이미지 재시도 선택자는 한 페이지의 여러 글 버튼을 한 개로 가정해 실패했다(A-resilience-first.json). 선택자를 수정한 최종 검사는 통과했다. B-live-before-reload.json은 이미 열린 동일 주소로 이동해 서버 재조회를 하지 않은 검사 실패다. 현재 검사는 새로고침으로 새 요청을 확인한다. 실패한 실행도 journal 기준으로 테스트 콘텐츠를 정리했다.

## 범위와 한계

실제 GitHub Pages·Supabase Auth/PostgREST/Edge/Storage를 사용했다. 로컬 대역 결과와 혼동하지 않는다. Chromium의 1280px/375px viewport 검사이며 실제 휴대폰·다른 브라우저 엔진을 검증한 것은 아니다.

로그아웃한 기존 개인 JWT는 두 프로젝트에서 즉시 401을 관찰했다. 정상 JWT의 1시간 자연 만료를 기다리는 관찰은 이번에 반복하지 않았다. 기존 회원 세션의 실제 15분 만료 검증은 member-session Step 7 기록에 있으며 세션 만료/갱신의 로컬 회귀도 다시 확인했다. Auth 만료 설정은 바꾸지 않았다.

옛 public URL의 정확한 주소와 캐시 우회 요청에서 새 파일 제공이 차단됨을 확인했다. 이미 다운로드한 사본·열려 있던 화면·브라우저 캐시·스크린샷은 회수할 수 없다. 다른 브라우저에서 비공개로 바꿨을 때 이미 열린 화면을 원격으로 지우는 실시간 구독은 이번 기능에 포함되지 않는다. 새 조회/새로고침/직접 주소에 서버 권한을 적용한다.

삭제 tombstone과 요청 재시도·인증/방문 로그는 서버의 정상 기록으로 남는다. 테스트 게시물·댓글·폴더·실제 파일 제거와 구분한다. 방문 수는 실제 테스트 방문으로 증가할 수 있으며 기존 집계나 인증 기록을 임의로 되돌리지 않는다.

## 최종 배포

| 사이트 | 최종 commit | Pages |
| --- | --- | --- |
| A | `2a9b8b4c38f4618b79ebee4b0f4dd60ac911134d` | [성공한 Pages 실행](https://github.com/henry-phd-finance/minihompy/actions/runs/35953994994) |
| B | `34670ccb31048104148a725777fb9c60d1bab05a` | [성공한 Pages 실행](https://github.com/henry-hs-jung/minihompy/actions/runs/35954065335) |

최종 함수 버전: A member-writing 12 / photo-media 3, B member-writing 8 / photo-media 1. 두 사이트 모두 mode=protected, ready=true이며 다섯 SQL 해시가 현재 소스와 일치한다(final-state.json). 원본 전체 파일은 A 1개/B 0개이고 최종 Storage 객체 수도 각각 1개/0개다. 백로그 4번의 폴더·공개/나만보기 범위만 완료했으며 일촌 공개는 후속으로 남겼다.
