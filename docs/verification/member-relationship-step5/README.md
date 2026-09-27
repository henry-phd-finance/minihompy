# 일촌 관계 Step 5 검증

2026-09-24. Step 4의 완료 기록 및 source-hashes.json 212개 항목이 일치함을 확인한 뒤 실행했다.

## 구현

관계 창의 **내 일촌 관리**는 방문자의 받은/보낸 신청함, **이 홈의 일촌**은 현재 홈 주인의 공개 확정 일촌 목록이다. 각 화면에 회원 이름과 handle을 명시한다. 기존 공통 회원 세션과 관계 repository를 사용하며 신청함 조회에 회원 ID를 넣지 않는다.

20개 단위 이전/다음 페이지, 빈 목록, 비활성 회원의 거절/취소, 조회 실패·요청 제한 재시도를 제공한다. 수락/거절/취소 성공 시 첫 페이지로 돌아가고 현재 홈 관계 표시를 갱신한다. 응답 유실은 같은 operation ID의 결과만 조회한다. 계정 전환 시 목록과 보류 작업을 제거하고 이전 응답을 버린다. 창 닫기·Escape·뒤로가기·메뉴 이동 시 목록과 확인 선택을 정리하고 관계 버튼으로 포커스를 돌린다. 불확실한 전송 결과는 같은 계정에서 결과를 확인할 수 있도록 메모리에만 유지한다.

일촌 방문은 기존 author-navigation의 중앙 회원 ID 기반 최신 주소 조회를 재사용한다. 전체 회원 파도타기는 별개로 유지한다. 확대 설정은 변경하지 않았다.

## 검증

- [목록 브라우저 검사](lists.log): 실제 index/CSS·목록 UI·repository·작성자 링크 모듈, Chromium 1280px/375px 총 10개 그룹. 신청 21개 페이지, 마지막 항목 수락 후 첫 페이지, 비활성 대상, 거절/취소, 빈 목록, 현재 홈 일촌 페이지, 최신 URL, 429 재조회, 응답 유실 복구, 로그아웃 중 지연 응답, 익명 공개 목록, Escape/뒤로가기/포커스/폭 검사. 이 검사는 인증 transport와 HTTP 응답을 fixture로 제공한다.
- [기존 관계 화면](widget.log): 실제 client/runtime/repository/navigation/UI, HTTP fixture 12개 그룹 통과.
- [실제 API/SQL](api.log): 실제 중앙·개인 handler와 PGlite SQL 12개 그룹 통과. A/B 받은 신청 관점 확인 및 타 회원 ID/actor/site 주입에 의한 신청함 접근 차단 검사를 추가했다.
- [client/runtime/repository](client.log) 5개 그룹 및 [공통 runtime](runtime.log) 회귀 통과.
- [Pages 산출물](build.log): 신규 모듈 포함, 서버·설정·비밀 파일 제외 확인.
- 화면: [1280px](lists-1280.png), [375px](lists-375.png). 모바일 폭의 스크린샷을 직접 확인했다. 실제 휴대폰이나 다른 브라우저 엔진 검사는 아니다.

재현:

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-relationship-lists.mjs /path/to/playwright/index.mjs
MINIHOMPY_RELATIONSHIP_UI_OUTPUT=docs/verification/member-relationship-step5/widget CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-relationship-ui.mjs /path/to/playwright/index.mjs
node scripts/verify-member-relationship-api.mjs
node scripts/verify-member-relationship-client.mjs
node scripts/verify-member-session-runtime.mjs
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
```

중앙 서버 구현·운영 DB·함수·Pages 배포는 변경하지 않았다. 일촌평은 Step 6 이후 범위다. [결과](results.json) · [소스/근거 해시](source-hashes.json).
