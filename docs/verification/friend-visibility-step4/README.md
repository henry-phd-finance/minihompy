# 일촌 공개 Step 4 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [HTTP 계약](../../friend-visibility-contract.md#12-step-4-개인-http-연결).

## 선행 확인과 구현

Step 3의 완료 기록과 manifest 383개가 모두 일치했다. 개인 `member-writing/content-read.js`를 추가하고 기존 handler에 list/detail/health 경로를 연결했다. 기존 API의 헤더·인증 흐름은 유지하며 새 경로에만 bounded transport와 보호 캐시 정책을 적용한다.

실제 중앙 grant 검사→요청별 중앙 read-context→개인 SQL→최종 개인 session/family 확인을 연결했다. actor/site/owner/session/요청/hash/관계·기한을 확인하고 DB 결과는 명시적 응답 필드로 제한한다. 만료·잘못된 context·장애·취소 시 보호 데이터를 반환하지 않는다. 공개/로컬 관리자 경로는 중앙에 의존하지 않는다.

회원 요청의 RPC 대기는 wall time과 monotonic 남은 기한 중 짧은 값으로 제한한다. 응답 생성 후에도 기한을 검사한다. request 취소와 timeout을 DB/HTTP AbortSignal에 전달하며 응답 body 크기와 대기도 제한한다. 늦게 끝난 작업을 성공으로 채택하지 않는다. 이 단계의 함수는 읽기이며 실제 PostgreSQL timeout/잠금 검사는 Step 2~3의 근거를 함께 유지한다.

## 검사 결과

| 명령 | 결과/근거 |
| --- | --- |
| `node scripts/verify-friend-visibility-api.mjs` | 실제 중앙/A/B/C handler·SQL 통합 13개 그룹, [integration.log](integration.log) |
| `node scripts/verify-friend-visibility-http.mjs` | 악성·정지 transport 경계 7개 그룹, [http.log](http.log) |
| `node scripts/verify-member-comments.mjs` | 기존 댓글 12개 그룹, [comments-regression.log](comments-regression.log) |
| `node scripts/verify-member-guestbook.mjs` | 기존 방명록 9개 그룹, [guestbook-regression.log](guestbook-regression.log) |
| `node scripts/verify-member-relationship-api.mjs` | 기존 관계 relay 12개 그룹, [relationships-regression.log](relationships-regression.log) |
| 기존 회원 세션 Chromium 통합, 1280px | 9개 시나리오, [sessions-regression.log](sessions-regression.log), [화면](sessions/ready-1280.png) |

브라우저 검사는 아래처럼 별도의 새 출력 경로를 사용했다. 이전 단계의 증거를 덮어쓰지 않았다.

```sh
MINIHOMPY_SESSION_INTEGRATION_OUTPUT=docs/verification/friend-visibility-step4/sessions \
CHROMIUM_PATH=/home/henry91-jung/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
node scripts/verify-member-session-integration.mjs \
/home/henry91-jung/miniconda3/envs/dark/lib/node_modules/playwright/index.mjs 1280
```

새 통합 검사는 기존 proof/PKCE/개인 세션 교환으로 A→B, A→A, B→A, C→B 세션을 발급했다. 개인 A/B는 서로 다른 DB이며 새 migration과 사진 보호 schema까지 적용했다. none/pending/accepted/self, 세 메뉴의 public/visible/owner 범위, 위조·다른 사이트 세션, 중앙 장애/429/구 서버, 변조된 context/DB 응답, 끊기 전후·비공개 전환·조회 후 로그아웃/관리자 철회·지연 결과와 중앙 로그아웃을 검증했다. 중앙 redirect·잘못된 JSON·멈춘 body도 차단했다.

HTTP 경계 검사는 실제 handler와 통제된 transport를 사용했다. 잘못된 UTF-8/필드/쿼리/method, 8 KiB 입력·1 MiB 전체 응답 제한, 보호 visibility 혼입, 내부 필드 제거, pre-cancel과 진행 중 취소, 멈춘 body 및 DB의 5초 취소를 확인했다. 이 과정에서 pre-cancel 시 미처리 rejection과 겹친 timeout의 취소 전달 문제를 수정하고 최종 검사를 다시 통과했다.

타이머 경계 검사에서는 wall clock이 테스트 도중 약 2.4초 이동하는 환경 현상을 확인했다. monotonic 실제 경과는 약 5초였으므로 시간 제한 assertions는 performance.now()를 사용한다. 운영 코드의 회원 기한 검사는 wall time과 monotonic을 모두 적용한다.

기존 Chromium 검사는 로그인→A 관리자→B 회원, 방명록/네 종류 댓글, 자동 갱신·입력/focus 보존, 메뉴 이탈 폐기, 장애 재시도, 탭/새로고침, 저장소 차단·중앙 절대 만료 흐름을 확인했다. 새 일촌 공개 화면 검사가 아니라 기존 공통 세션 회귀다.

변경된 JavaScript 문법 검사 및 두 저장소 diff 공백 검사도 통과했다. [results.json](results.json) · [source-hashes.json](source-hashes.json).

## 범위와 한계

중앙·개인 인증/관계/콘텐츠 handler와 SQL은 실제 구현이다. 개인 Supabase Auth HTTP, readiness 활성화 및 사진 자산 등록은 로컬 fixture이며 운영 계정·실제 파일 바이트·운영 timeout을 검증한 것은 아니다. 새 읽기 화면·회원 댓글·사진/요약 연결은 다음 단계다.

운영 배포·Secrets·운영 데이터는 변경하지 않았다. Step 5~13은 미착수다.
