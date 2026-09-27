# 일촌 공개 Step 5 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [댓글 계약](../../friend-visibility-contract.md#13-step-5-일반-댓글-권한).

선행 Step 4 완료 기록과 기준 파일 398개를 확인했고 모두 일치했다. 일반 댓글에 요청별 중앙 read-context와 현재 부모 권한을 연결했다. 목록/건수/변경/재시도/결과 조회는 동일한 부모 정책을 적용한다. 작업 기록에 부모를 연결하고 삭제 후에도 유지한다. 기존 기록은 보존하며 명시적인 결과 조회에서 부모를 추측하지 않는다.

## 결과

| 명령/검사 | 통과 | 근거 |
| --- | --- | --- |
| `node scripts/verify-friend-comments-api.mjs` | 10개 그룹 | [api.log](api.log) |
| `node scripts/verify-friend-comments-concurrency.mjs` | 12개 그룹 | [concurrency.log](concurrency.log) |
| `node scripts/verify-friend-visibility-api.mjs` | 13개 그룹 | [read-regression.log](read-regression.log) |
| `node scripts/verify-friend-visibility-http.mjs` | 7개 그룹 | [http-regression.log](http-regression.log) |
| `node scripts/verify-member-comments.mjs` | 12개 그룹 | [comments-regression.log](comments-regression.log) |
| `node scripts/verify-member-guestbook.mjs` | 9개 그룹 | [guestbook-regression.log](guestbook-regression.log) |
| `node scripts/verify-member-session-renewal.mjs` | 14개 그룹 | [renewal-regression.log](renewal-regression.log) |
| Chromium 공통 회원 세션, 1280px | 9개 시나리오 | [sessions-regression.log](sessions-regression.log), [화면](sessions/ready-1280.png) |

API 검사는 실제 중앙 및 개인 A/B SQL과 handler, proof/PKCE/세션 교환을 사용한다. 비일촌/대기/확정/끊기/재연결, 세 종류 부모, 타인 소유권, 관리자 삭제, private 전환, 삭제된 댓글의 결과, 응답 유실·중복·충돌, 중앙 장애/429/context 변조, 커밋 후 로그아웃·새 로그인 복구를 확인했다. Supabase Auth HTTP와 readiness·사진 자산 등록은 로컬 fixture다.

독립 PostgreSQL 16 연결은 공개범위 변경과 작성의 양쪽 순서, 서로 다른 로컬 family의 동일 요청, 로그아웃 양쪽 순서, 기존 receipt 마이그레이션 보존과 ACL을 검증했다. 처리 중 기한 만료 시 댓글·quota·receipt 모두 롤백한다. 실제 PostgREST 14.5 호출의 3초 statement timeout도 전체 롤백을 확인했다. 테스트 전용 trigger로 지연을 만들고 일회용 DB/container는 제거했다. 처음 fixture의 중복 delegation/grant 값은 서로 다른 값으로 수정한 뒤 전체를 재실행했다.

커밋 후 응답 오류는 저장 실패를 보장하지 않는다. 현재 권한이 복구된 뒤 동일 요청/결과 조회로 중복 없이 확인한다. 목록과 건수는 한 snapshot을 사용한다. 기존 댓글/방명록 검사에는 공통 private/no-store 응답 헤더 기대값만 반영했다.

브라우저 회귀 실행:

```sh
MINIHOMPY_SESSION_INTEGRATION_OUTPUT=docs/verification/friend-visibility-step5/sessions \
CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
node scripts/verify-member-session-integration.mjs \
/home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs 1280
```

기존 공통 세션의 자동 갱신·메뉴 이탈·장애·독립 탭·저장소 차단을 확인한 회귀이며 새 일촌 공개 화면 검증은 아니다. 변경 JavaScript 문법 및 두 저장소 diff 공백 검사도 통과했다. [결과](results.json) · [소스 기준](source-hashes.json).

운영 배포·Secrets·운영 데이터는 변경하지 않았다. 사진 바이트·홈 집계·화면 연결·운영 검증은 Step 6~13이다. 기존 미커밋 변경과 이전 단계 근거를 보존했다.
