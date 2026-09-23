# 회원 작성 기능 배포·복구

## 순서

1. 중앙/개인의 기존 연결 정보·방명록·댓글을 비공개 저장소에 백업하고 현재 함수/Pages 커밋을 기록한다. 공개 검증 기록에는 개수·해시와 결과만 남긴다.
2. 중앙 저장소에서 기존 중앙 배포 환경변수(CENTRAL_PROJECT_REF, SUPABASE_ACCESS_TOKEN, CENTRAL_TOKEN_SECRET, CENTRAL_ORIGIN, CENTRAL_PAGE_URL)를 준비하고 `node scripts/deploy-member-writing.mjs --apply`를 실행한다. 이력·해시를 검사하며 `202609230002_member_writing.sql`을 한 번 적용한 뒤 함수를 배포한다. 기존 서명키를 그대로 사용한다.
3. 중앙 `public/writing.html`, `writing-flow.js` 및 나머지 최신 Pages 런타임을 배포한다. `/health`의 `writing_protocol: 1`과 실제 writing 페이지를 확인한다.
4. 각 개인 사이트에서 `node setup/setup.mjs writing --config setup/config.json`을 실행한다. 중앙 검증 완료 siteId와 해당 사이트의 공개 URL/키, 개인 소유자 로그인, 해당 Supabase의 Management token을 사용한다.
5. 개인 마이그레이션은 foundation → sessions → guestbook → comments 순서다. `private.minihompy_setup_migrations`에 파일명·SHA-256을 저장한다. 신규 `install`이 이미 적용한 파일은 같은 해시인지 확인하고 건너뛴다. 추적하지 않던 기존 사이트도 옛 마이그레이션을 다시 적용하지 않고 회원 추가분부터 추적한다.
6. 설정/개인 함수 검증이 통과한 뒤 각 사이트의 최신 런타임과 활성화 설정을 Pages에 배포한다. 각자의 supabase-config, visitor-identity-config, 프로필/디자인 설정과 소유권 확인 파일은 유지한다.
7. 실제 별도 브라우저 A/B 로그인, 공개·비밀 글/댓글, 소유권/주인 권한/로그아웃을 전용 테스트 콘텐츠로 검증하고 생성한 UUID만 정리한다. 기존 콘텐츠를 이전 값과 비교한다.

## 실패와 복구

- 마이그레이션 파일 하나와 적용 이력 삽입은 동일 트랜잭션이다. 오류 발생 시 해당 파일이 롤백되며 후속 파일은 실행하지 않는다. 이미 성공한 파일은 이력/해시를 확인하고 재실행하지 않는다.
- 함수 배포·관리자 확인 실패 시 활성화 파일을 새로 켜지 않는다. 실패 원인을 수정하고 같은 명령을 재시도한다. 비밀번호나 토큰을 오류 로그에 남기지 않는다.
- 화면 장애 시 해당 사이트의 `member-writing-config.js`를 false로 바꾸어 Pages를 배포해 새 회원 쓰기를 중지할 수 있다. 기존 회원 콘텐츠/소유권 필드는 보존한다. 이 상태의 구형 익명 경로는 회원 비밀글 조회·수정/삭제를 제공하지 않으므로 회원 관리가 필요하면 수정된 서버/화면으로 다시 활성화한다.
- 적용된 SQL을 역순 DROP하거나 회원 행을 익명 UUID로 바꾸지 않는다. 새 회원 콘텐츠가 생긴 뒤 과거 DB 스냅샷을 전체 복원하면 이후 글을 잃을 수 있다. 문제가 있으면 회원 쓰기를 중지하고 백업·이력으로 원인을 확인한 뒤 후속 수정 마이그레이션으로 복구한다.
- 중앙 버전은 개인 화면보다 먼저 배포한다. 신형 개인 서버를 유지한 채 중앙만 구형으로 되돌리면 회원 검증이 실패한다. 복구 중 인증을 우회하거나 익명 쓰기로 자동 전환하지 않는다.
- 서버에서 이미 승인된 요청은 로그아웃과 경합해 완료될 수 있다. 화면은 그 응답을 다음 계정에 표시하지 않는다. 운영 검증 중 재시도/정리에는 UUID와 요청 ID를 유지한다.

개인 프로젝트에 필요한 설정은 MINIHOMPY_SITE_ID, MINIHOMPY_SITE_ORIGIN, MINIHOMPY_CENTRAL_API_URL, MINIHOMPY_PUBLIC_KEY다. Supabase 기본 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY는 해당 프로젝트의 Edge 환경에서만 사용한다. 중앙 HMAC 비밀키를 공유하지 않는다.
