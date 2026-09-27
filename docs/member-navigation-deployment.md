# 회원 이동 기능 배포와 복구

2026-09-23. 개인 DB 변경은 없으며 기존 회원·사이트·콘텐츠를 유지한다. 중앙에 읽기 전용 `private.identity_navigation` 함수를 추가한다. 로그인·작성 권한의 계약은 유지한다.

## 배포 순서

1. 중앙 회원·사이트·바인딩과 A/B public 테이블을 비공개로 백업하고 각 저장소의 현재 커밋을 기록한다. 설정·비밀값을 Git에 추가하지 않는다.
2. 중앙에서 기존 `CENTRAL_TOKEN_SECRET`, `CENTRAL_ORIGIN`, `CENTRAL_PAGE_URL`, `CENTRAL_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` 환경변수를 유지한 채 `node scripts/deploy-navigation.mjs --apply`를 실행한다. SQL 배포 이력을 검사하여 동일 파일 재실행은 건너뛰고 해시가 바뀌거나 추적되지 않은 함수가 있으면 중단한다. SQL 성공 뒤 함수 배포가 실패하면 같은 명령으로 재시도한다.
3. `/health`의 `navigation_protocol: 1` 및 기존 `writing_protocol: 1`, `/directory?handle=...`와 새 공개 조회를 확인한다.
4. 개인 사이트의 기존 설정·프로필·디자인을 보존하고 최신 런타임을 적용한다. `node setup/setup.mjs navigation --config <공개 설정 파일>` 및 Pages build/artifact 검사를 통과시킨 뒤 A/B를 배포한다.
5. 실제 로그인·이동·로그아웃·계정 전환을 검사하고 배포 파일 해시와 데이터를 비교한다. 임시 콘텐츠를 만든 경우 해당 실행의 ID와 본문이 일치하는 항목만 삭제한다.

## 복구

배포 직전 중앙: `e099478c923e0a2f47b1a14f30b6d90c44acd9e2`, A: `680f74b224843e2f84030a061f937b71169a5d66`, B: `9f8e494c04dd7f3fc6d691d70a6b9d4168427180`.

개인 화면에 문제가 있으면 해당 배포 전 커밋의 Pages 산출물로 먼저 복구한다. 새 중앙 조회는 이전 개인 화면과 호환되므로 유지할 수 있다. 중앙 복구가 필요하면 개인 화면 복구 후 별도 checkout에서 중앙의 배포 전 버전 `scripts/deploy-functions.mjs --apply`를 동일한 기존 Secret으로 실행한다. Secret을 새로 생성하지 않는다. 추가한 읽기 함수·배포 이력은 데이터 수정 없이 남겨 둔다. DB 전체를 과거 백업으로 덮어쓰지 않는다. 이후 새 버전을 재배포할 때 같은 SQL 파일과 기록의 해시를 확인한다. Git 이력은 force push로 되돌리지 않는다.

비공개 백업: `~/.local/state/minihompy-deployment/member-navigation/`. 공개 배포 버전·검증 결과는 [Step 6 기록](verification/member-navigation-step6/README.md)에 둔다. 실제 일촌 관계는 백로그 5번의 후속 작업이다.
