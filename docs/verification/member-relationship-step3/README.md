# 일촌과 관계 기능 Step 3 — API·개인 서버 중계·브라우저 호출

2026-09-24 완료. Step 2 완료 기록과 source-hashes **178개 모두 일치**를 확인하고 착수했다. [계약](../../member-relationship-contract.md) · [실행 계획](../../member-relationship-plan.md).

## 구현한 범위

중앙의 관계 SQL RPC를 HTTP API로 연결하고 개인 서버의 검증된 회원 세션으로 중계했다. 브라우저 공통 세션에는 관리자 context와 분리된 관계 호출 경로, 불변 작업 ID를 이용한 repository를 추가했다.

- 중앙: friends/state/requests/actions/operations 및 서버용 review-permits, readiness probe, strict 입력·출력 필터, wire cursor, 상태별 오류/Retry-After, 신뢰 가능한 연결 상대 주소 기반 공개 조회 제한.
- 개인: member mode 전용 중계, site 고정·서버 grant 사용, 응답 전 local session 재검사, 오류 구분 보존. 서버용 permit helper는 owner/actor/site/session/hash/시간을 검증하며 브라우저 route는 제공하지 않는다.
- 브라우저: 기존 자동 갱신 공유, 항상 member bearer 사용, 계정 generation 검사, prepare/execute/recover 작업 수명, 새 호출 모듈의 Pages 포함. 공통 확인 외 별도 로그인이나 인증 저장소는 만들지 않았다.
- 양쪽 shared protocol 사본은 통합 검사에서 동일 바이트인지 확인한다. Step 2 SQL은 변경하지 않았다.

## 최종 검증

| 명령 | 결과 | 기록 |
| --- | --- | --- |
| `node scripts/verify-member-relationship-api.mjs` (cyworld) | 실제 중앙/개인 handler·SQL 통합 12개 그룹 | [api.txt](api.txt) |
| `node scripts/verify-member-relationship-client.mjs` (cyworld) | 실제 client/runtime/repository VM 5개 그룹 | [client.txt](client.txt) |
| `node scripts/verify-all.mjs` (minihompy-central) | 기존 관계 SQL 포함 중앙 16개 스위트 | [central-all.txt](central-all.txt) |
| `node scripts/verify-member-writing-session.mjs` (cyworld) | 기존 개인 세션 10개 그룹 | [personal-session.txt](personal-session.txt) |
| `node scripts/verify-member-session-runtime.mjs` (cyworld) | 자동 갱신·숨긴 탭·계정 전환 회귀 | [runtime.txt](runtime.txt) |
| `node scripts/verify-member-writing-client.mjs` (cyworld) | 기존 proof·저장소·철회·실패 처리 회귀 | [writing-client.txt](writing-client.txt) |
| `node scripts/build-pages.mjs`, `node scripts/verify-artifact.mjs` (cyworld) | Pages 44개 runtime entry 및 새 repository 포함, 서버/비밀 파일 제외 | [artifact.txt](artifact.txt) |

API 검사는 실제 v2 proof/PKCE → 개인 session 교환 → 중앙 RPC까지 연결한다. UUID 위조, 잘못된 사이트, owner JWT 대체, caller identity injection, Content-Type/길이/미등록 필드, CORS, 비공개 신청함, cursor round-trip/scope, 오류/헤더, 30초 permit의 바인딩·시간 검사를 포함한다. 중앙에서 커밋한 뒤 응답을 유실시키고 동일 작업 ID로 결과를 복구했다. 조회 중 local logout 및 중앙 logout도 검사했다. 공개 목록 제한은 사용자 forwarding header로 바꿀 수 없음을 확인했다.

클라이언트 검사는 실제 소스를 VM에 로드하고 네트워크/DOM을 대역으로 제공했다. 동시 호출의 갱신 공유, 로컬 관리자 로그인과 중앙 회원의 자격 분리, 응답 유실 시 재전송하지 않음, 공통 retry 후 결과 조회, 계정 전환 뒤 이전 응답·작업 재사용 차단, 익명/비활성 차단과 공개 목록의 credential omission을 확인했다.

## 범위와 제한

PGlite에서 실제 migration과 handler를 사용했으나 HTTP 전송은 Request/Response 주입이다. 실제 브라우저 UI·운영 네트워크·Supabase 게이트웨이 검증으로 간주하지 않는다. PostgreSQL 다중 연결 경합은 변경하지 않은 Step 2 SQL 근거를 유지하며 이번에는 API/인증 연결을 검사했다.

공개 조회의 trusted transport peer는 게이트웨이 주소일 수 있어 실제 운영에서는 여러 사용자가 quota를 공유할 수 있다. 주소가 없으면 임의 헤더로 대체하지 않고 503으로 거절한다. 운영 주소 가용성/집계 단위 확인은 Step 9~10 항목이다. DB/RPC가 준비되지 않은 중앙은 health protocol 0, 개인은 relay_ready false로 표시한다. 일촌평 저장 readiness는 계속 false다.

운영 DB·함수·Pages는 변경하지 않았다. 화면 관계 버튼/관리 창은 Step 4~5, 개인 DB 일촌평은 Step 6, 실제 운영 검증은 Step 10이다. 기존 미커밋 작업은 보존했으며 Step 4는 시작하지 않았다. [결과 요약](results.json) · [소스/증거 해시](source-hashes.json).
