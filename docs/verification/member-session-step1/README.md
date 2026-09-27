# 공통 회원 세션 Step 1 검증

2026-09-23. 설계와 최소 실증 완료. 운영 런타임·SQL·설정 및 중앙 저장소는 변경하지 않았다.

## 선행 확인

- [회원 작성 Step 7](../member-writing-step7/README.md): 배포·실계정 작성·콘텐츠 정리·보존 기록 확인.
- [회원 이동 Step 6](../member-navigation-step6/README.md): 중앙/A/B 버전·실제 이동·권한 분리·보존 기록 확인.
- [홈 데이터 Step 7](../home-data-step7/README.md): 최종 운영 배포·인증/작성 회귀·보존 기록 확인.
- `visitor-identity.js`, `member-writing-runtime.js`, 개인 세션 handler 및 중앙 visit/writing 흐름·SQL을 읽어 현재 별도 왕복, 중앙 저장소, 15분/중앙 30일 절대 만료 구조를 확인했다.
- 기존 `verify-member-writing-session.mjs`를 재실행하여 실제 중앙/개인 PGlite SQL 및 운영 handler를 사용하는 10개 검사 그룹 통과. [결과](existing-session.txt). 이번 단계에서 운영 서버를 다시 수정하거나 실제 계정 로그인하지 않았다.

## 실증 결과

[계약 v2](../../member-session-contract.md)는 첫 왕복의 PKCE 증명과 사이트 한정 서버 갱신 위임을 채택한다. iframe·중앙 브라우저 저장소 접근이 자동 갱신의 필수 조건이 아니다.

`scripts/verify-member-session-prototype.mjs`는 서로 다른 포트의 중앙/A/B HTTP 서버를 실제로 띄우고 headless Chromium으로 왕복·교환·갱신한다. 서버는 메모리 fixture이고 시계는 논리 시계다. 최초 로그인만 중앙 localStorage에 fixture 자격을 미리 넣으며 실제 비밀번호 로그인은 이 실증에 포함하지 않는다. PKCE 해시는 실제 SHA-256을 사용한다.

[프로토타입 결과](prototype.txt): 10개 검사 그룹 통과.

- A/B 각 사이트에 최초 왕복 후 증명 교환 성공.
- 논리 시계 1시간 경과 후 작성 토큰은 401, 독립된 갱신 핸들로 재발급 성공.
- 갱신 중 브라우저의 중앙 요청을 차단해도 성공. 실제 중앙 요청 0, 추가 화면 이동/팝업 0, 입력·포커스·주소 유지. 개인 origin에는 중앙 로그인 토큰이 없음.
- 갱신 핸들로 콘텐츠 요청 또는 다른 개인 사이트 갱신 불가. 중앙 위임도 다른 사이트에서 갱신 불가.
- 이미 사용한 증명, 잘못된 PKCE, 만료 증명, 비로그인 발급 거절.
- 중앙 장애는 503, 복구 후 성공 및 입력 유지. 중앙 로그아웃 및 절대 만료는 401.

실증은 아키텍처의 실행 가능성과 위협 경계를 확인한 것이다. 실제 브라우저 추적 방지 정책을 재현했다고 주장하지 않는다. 중앙 브라우저 접근을 완전히 차단한 갱신 실험이며, 처음 중앙 top-level 방문에는 중앙 first-party 저장소 접근이 필요하다. 이를 사용자 설정이 막으면 공통 오류를 표시해야 한다.

실제 SQL 마이그레이션·서명 증명에 새 필드 결합·트랜잭션 경합·원본 사이트 상태·version 변화·철회 race·신규/구버전 호환은 Step 2~3에서 구현·검증한다. 계정 전환·초안 폐기·모바일 UI·전체 브라우저 통합은 Step 4~6, 운영 적용은 Step 7이다. 현재 화면에서 회원 확인 버튼은 아직 유지된다.

## 재실행

```sh
CHROMIUM_PATH=/path/to/chrome node scripts/verify-member-session-prototype.mjs /path/to/playwright/index.mjs
node scripts/verify-member-writing-session.mjs
```

Playwright는 환경에 이미 설치된 Python 패키지의 `driver/package/index.mjs`, Chromium은 캐시의 headless shell을 사용했다. 외부 네트워크·운영 비밀값·DB 배포는 필요하지 않다. 기존 세션 검사는 인접 중앙 저장소와 그 PGlite 의존성을 사용한다.
