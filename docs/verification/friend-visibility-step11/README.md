# 일촌 공개 Step 11 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [계약](../../friend-visibility-contract.md#19-step-11-통합-검증-경계).

선행 Step 10 기준 파일 515개가 모두 일치한 뒤 시작했다. **최종 37개 스위트가 통과**했고 검사 범위에서 미해결 권한·데이터 노출 결함은 발견하지 못했다. 제품 JS/SQL/중앙 코드와 운영 환경은 변경하지 않았다. 테스트·테스트 대역·출력 경로·완료 문서만 변경했다.

## 전체 흐름

새 `verify-friend-visibility-integration.mjs`는 분리된 중앙/A/B DB와 제3자 C를 사용한다. 실제 PKCE 증명·세션 발급, 중앙 관계 handler/SQL, 개인 handler/SQL과 보호 PNG 바이트를 연결한다. A/B에 같은 게시물 ID와 서로 다른 제목/본문을 넣어 대상 프로젝트 혼동도 검사한다.

1. 수락 전/신청 중/익명은 공개 글만 본다. 목록/상세/댓글/파일/요약/달력/글 위치를 모두 확인한다.
2. 수락 후 A→B와 B→A는 공개+일촌, C는 공개, 로컬 관리자는 세 범위를 본다. 중앙 회원 ID만 자기 홈 주인과 같은 경우는 공개만 본다. 타 프로젝트 세션은 거절한다.
3. 최신 전체 migration을 설치한 DB에서 로컬 익명 계정의 공개 댓글 작성·수정·삭제는 유지한다. 일촌 글 직접 RLS 조회/댓글 작성, service 전용 RPC 호출, permissive Storage 정책을 추가한 파일 조회 우회는 거절한다. 기존 공개 홈 집계와 글 위치는 일촌 정보를 노출하지 않는다.
4. 세 메뉴의 회원 댓글 작성 후 응답 유실을 주입한다. 재전송은 같은 결과로 복구하고 B에만 한 번 저장하며 중앙 회원 작성자와 요약 댓글 건수를 확인한다.
5. 관계를 끊으면 양쪽의 새 조회와 이전 댓글 작업 결과/재전송에서 일촌 글·댓글·파일·제목·건수·날짜·위치가 사라진다. 끊기 전에 받은 응답 객체는 이미 전달된 정보라는 점을 구별한다.
6. 중앙 장애/429는 회원 조회 전 표면에 실패로 전달하며 공개/로컬 관리자 조회는 독립적으로 동작한다. 오류를 빈 결과나 익명 성공으로 바꾸지 않는다.
7. 개인 SQL 이후 로컬 family 철회는 성공 응답을 폐기한다. 새 로그인 후에는 정상 복구하고, 중앙 세션 철회는 양쪽 자격/조회 경계에서 거절한다. C의 별도 세션은 유지된다.

[전체 흐름 7개 그룹 로그](cross-surface.log).

## 독립 DB와 실제 HTTP 경합

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 중앙 권한/관계/세션 경합 | 10개 그룹 | [central DB](central-verify-friend-visibility-concurrency.log) |
| 개인 게시물·세션·준비 상태·직접 REST/RPC | 12개 그룹 | [content DB](verify-friend-visibility-db-concurrency.log) |
| 댓글 부모·세션·작업 결과·시간 제한 | 12개 그룹 | [comments DB](verify-friend-comments-concurrency.log) |
| 사진 부모·파일·세션·기한 | 4개 그룹 | [photo DB](verify-friend-photo-concurrency.log) |

일회용 로컬 PostgreSQL 16 컨테이너와 서로 다른 연결의 실제 row-lock 경합을 사용했다. 중앙/글/댓글 검사는 실제 PostgREST 요청과 DB timeout도 포함한다. 개인 글/댓글 경합 테스트는 이번 단계에서 migration 011까지 설치하도록 확장했다. 기존 댓글 receipt 업그레이드 보존 검사는 그대로 유지했다. 모든 컨테이너는 각 테스트의 정리 경로로 종료했다.

관계 끊기·중앙 로그아웃·회원/사이트 비활성화가 먼저 확정되면 대기하던 확인도 새 상태를 본다. 반대로 읽기 허가가 먼저 확정된 경우 그 허가의 짧은 유효 경계와 다음 요청 차단을 구분한다. 개인 DB에서는 private 전환·로컬 로그아웃·readiness 변경·댓글 재전송과의 잠금 순서, 기한 초과/취소 시 결과·mutation rollback을 검사한다.

사진 서버는 실제 파일 바이트 전후 관계 확인, Storage 대기 중 끊기/비공개 전환, 최종 세션 철회, 취소·크기·MIME/해시·timeout을 재검증했다. [사진 API](verify-friend-photo-api.log), [HTTP 경계](verify-friend-photo-http.log), [기존 사진 보호](verify-photo-media.log).

## 브라우저와 회귀

| 범위 | 결과와 근거 |
| --- | --- |
| 실제 홈, 1280/375px | 8개 시나리오: [로그](verify-friend-home-browser.log), [모바일](home/member-375.png) |
| 실제 게시판·다이어리, 1280/375px | 6개 시나리오: [로그](verify-friend-menus-browser.log), [게시판](menus/board-375.png), [다이어리](menus/diary-375.png) |
| 실제 사진첩, 1280/375px | 10개 시나리오: [로그](verify-friend-photos-browser.log), [모바일](photos/photos-375.png) |
| 중앙/A/B 관계·일촌평 및 브라우저 | [로그](verify-member-relationship-integration.log) |
| 실제 자동 로그인·갱신·장애·탭·만료 | 기존 9개 시나리오: [로그](verify-member-session-integration.log) |
| 실제 중앙 로그인과 A↔B 이동, desktop | [로그](verify-navigation-integration.log) |
| 모바일 이동과 실제 방문 집계 SQL/Edge | [로그](navigation-visits-mobile.log) |
| 작성자 링크·파도타기, desktop/mobile | [작성자](verify-author-navigation.log), [파도타기](verify-surf-navigation.log) |

브라우저는 추가 회원 확인 버튼 없이 공통 세션을 사용하며 다른 계정의 지연 응답·숨겨진 글 직접 주소·실패 후 남은 제목/사진/댓글을 검사했다. 사진 다운로드 중 계정 변경·관계 끊기와 성공 파일 응답 이후 비공개 전환도 포함한다. 관계 화면과 자동 세션/이동 검사는 별도의 실제 login/PKCE 흐름을 확인하며, 이동·추가 탭·로그아웃 중 사이트별 방문 횟수는 한 번으로 유지된다.

개인/중앙 API의 필드·자격 결합·429/지연·철회·구 준비 상태, 공통 읽기/갱신 client, 기존 회원 댓글/비회원 경로·방명록 비밀글·일촌평·사진 보호·공개 홈 요약·방문·글 위치를 회귀 실행했다. [최종 스위트별 명령/환경/결과](suite-results.json)에 37개 전체 로그를 연결했다. [요약 결과](results.json).

## 검사 중 수정한 테스트 구성

- 기존 사진 보호 migration을 함께 설치한 댓글 테스트에는 실제 제약에 맞는 protected readiness와 첨부 asset metadata가 필요했다. 이 테스트의 fixture를 보완했으며 제품 권한/검사 기대값은 완화하지 않았다. Storage 바이트는 별도 사진 검사에서 검증한다.
- 신규 통합 테스트의 다이어리 위치는 날짜 안의 순위이므로 목록 확인에 해당 `entry_date`를 전달하도록 맞췄다. 중앙 self 회원의 기대값도 계약상 공개 전용으로 맞췄다. 직접 댓글 fixture는 기존 스키마에 필요한 UUID를 명시했다.
- 오래된 작성자 링크 테스트는 현재 없는 이탈 확인창을 기다렸다. 실제 PostRoutes를 로드하고 조회 갱신 중 초안 유지, 링크로 다른 홈 방문 시 확인창 없이 이동하는 현재 동작을 검증하도록 갱신했다. 제품에 예전 확인창을 다시 추가하지 않았다.
- 모든 화면 테스트에 별도 결과 경로를 지정했다. 필요한 기존 테스트에 `VERIFICATION_DIR` override만 추가하여 과거 스크린샷/증거를 덮어쓰지 않았다. 첫 실행의 잘못된 브라우저 인자와 위 fixture 실패는 수정 후 해당 스위트를 다시 통과했다. 초기 `*-suites.json`, `final-rerun.log`에는 실패 이력이 남아 있으며 **최종 판정은 `suite-results.json`**이다.

## 재현

저장소 루트에서 `PLAYWRIGHT_PATH`에 설치된 Playwright 모듈 경로, 필요하면 `CHROMIUM_PATH`에 Chromium 실행 파일을 지정하고 다음을 실행한다.

```sh
node scripts/verify-friend-visibility-suite.mjs
```

그룹(`db`, `api`, `browser`, `regression`, `integration`)이나 개별 suite 이름을 인자로 주면 선택 실행한다. Docker와 로컬 PGlite/pg/Playwright 의존성이 필요하다. `VERIFICATION_DIR`로 새 출력 폴더를 지정할 수 있다. 검증 시 Playwright는 `/home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs`, Chromium은 `/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`를 사용했다. 변경 JS 문법 및 두 저장소 diff 공백 검사도 통과했다. [소스/증거 기준](source-hashes.json).

## 경계와 남은 단계

새 통합 검사는 실제 중앙/A/B handler·SQL과 세션/관계/파일 바이트를 사용하지만 Auth HTTP·Storage는 로컬 대역이다. PGlite는 단일 연결이므로 동시성 증거는 별도의 PostgreSQL/PostgREST 검사로 구분했다. 새 화면 검사의 route shell·방문자 표시·Auth와 DB query-builder 전송은 fixture이며, 운영 브라우저 로그인이나 실제 Supabase Storage 네트워크를 대신하지 않는다. 기존 사진 HTTP 검사는 실제 loopback adapter를 포함한다.

이미 전달·다운로드된 데이터를 회수한다거나 분리된 DB 사이에 무조건적인 즉시 철회가 보장된다는 뜻이 아니다. 허가가 먼저 발급된 요청의 계약상 기한과 새로운 조회/전송 시작 전 확인을 검사했다. 중앙 장애·429·응답 유실은 격리 환경에서 주입했으며 운영 장애를 유발하지 않았다.

운영 계정·DB·Secrets·관계·Storage·배포/readiness는 변경하지 않았다. 신규 설치/업그레이드/복구 절차는 Step 12, 운영 적용·실제 계정 확인·정리는 Step 13의 미완료 작업이다. 백로그 전체 완료 체크는 그대로 미체크로 유지한다.
