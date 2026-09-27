# 홈 데이터 Step 1 — 공개 요약 조회 기반

완료: 2026-09-23. 로컬 구현·검증만 수행했다. 운영 DB·중앙 서버·A/B Pages에는 적용하지 않았다.

## 선행 조건

회원 작성 Step 1~7, 회원 이동 Step 1~6 완료 상태와 각 최종 운영 검증 기록(`member-writing-step7/live.json`, `member-navigation-step6/live.json` 및 보존/배포 기록)을 확인했다. 이번 계획의 첫 구현 단계이므로 홈 데이터 계획 내 이전 Step은 없다.

## 구현

- [공개 홈 요약 계약 v1](../../home-data-contract.md): 단일 RPC, 공개 최신 5개, 메뉴별 오늘/전체, 공개 부모의 오늘 댓글 수, 서버 한국 날짜와 메뉴 필터.
- `supabase/migrations/202609230005_home_summary.sql`: 공개 RPC와 제한된 내부 함수, 최근글/댓글 집계 인덱스. 기존 콘텐츠·설정·권한 정책은 변경하지 않는다.
- `home-repository.js`: visitor RPC 한 번, 입력/응답 검증, 취소 signal 전달, 오류와 0건 구분. 관리자·중앙 작성 세션을 사용하지 않는다.
- 실제 SQL 테스트 helper에 새 마이그레이션을 포함했고 릴리스 검사 목록과 Pages 필수 산출물 검사에 새 모듈/검사를 등록했다.

홈 UI에 연결하거나 실제 글 주소·방문 집계를 구현하지 않았다. 현재 세 종류 일반 게시물은 공개 전용 스키마다. 미래 공개범위 구현에서 RLS뿐 아니라 요약 RPC의 공개 조건도 함께 확장해야 하는 의존성을 계약에 명시했다.

## 검증

| 증거 | 범위 |
| --- | --- |
| `sql.txt` | 실제 PostgreSQL 호환 PGlite 8개 그룹. 0건/비공개만 존재, 입력/설정 오류, 네 종류 최신 5개 정렬, 제한된 텍스트, 공개 부모 댓글, 로컬/중앙 작성자 동일 조건, 한국 자정/미래 시각/사용자 지정 일기 날짜, 서버 숨김 메뉴, 삭제·비공개 전환·수정, 마이그레이션 재적용과 전체 원본 필드 보존, populated 익명/회원/관리자 RPC 결과 동일성, 내부 함수/비허용 역할 실행 차단. |
| `repository.txt` | VM에서 클라이언트 경계 검사. 실제 네트워크 대신 RPC stub으로 요청 수·클라이언트 종류·abort 전달·잘못된 응답 차단·오류 처리 확인. |
| `member-guestbook.txt` | 새 마이그레이션 포함 실제 중앙/개인 SQL·핸들러 회원 방명록 권한 회귀. |
| `member-comments.txt` | 새 마이그레이션 포함 실제 중앙/개인 SQL·핸들러 네 종류 댓글 권한 회귀. |
| `artifact.txt` | Pages build와 산출물 검사. 새 repository 포함, SQL/검증/비밀 파일 배포 제외. |

`node --check home-repository.js`, `git diff --check` 통과. UI 변경이 없어 실제 브라우저/운영 데이터 검사는 이번 단계에서 실행하지 않았다. 화면 연결 후 Step 3/6에서 수행한다.

재실행:

```sh
node scripts/verify-home-summary.mjs /path/to/pglite/dist/index.js
node scripts/verify-home-repository.mjs
node scripts/verify-member-guestbook.mjs /path/to/pglite/dist/index.js
node scripts/verify-member-comments.mjs /path/to/pglite/dist/index.js
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

PGlite 경로를 생략하면 이 환경의 인접 `../minihompy-central/node_modules`를 사용한다. 테스트 계정·콘텐츠는 메모리 DB fixture만 사용하며 운영 콘텐츠를 만들지 않는다. 실제 SQL fixture 시각/종류 구성을 위한 INSERT/UPDATE에서만 테스트의 replication role을 사용한다. 공개 RPC·권한 검증은 실제 함수/권한으로 실행한다.
