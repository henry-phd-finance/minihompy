# 공통 회원 세션 v2 배포·복구

Step 6 완료 후 중앙 → 개인 DB/함수 → 중앙/A/B Pages 순서로 진행한다. 중앙 키·기존 사이트 설정·회원 연결·콘텐츠는 유지한다.

1. 별도 원격 main 체크아웃으로 배포 전 커밋을 고정한다. 중앙 회원/사이트/바인딩, A/B public 데이터·관리자/사이트 연결과 기존 함수 정의를 비공개 백업한다.
2. 중앙 `scripts/deploy-member-sessions.mjs --apply`는 기존 회원 작성 설치에 004를 해시 추적 적용하고 identity-api/identity-page를 배포한다. 중앙 서명키는 교체하지 않는다. 신규 중앙은 기존 기본/회원 작성/이동 설치 후 실행한다.
3. 중앙 `/health`의 `member_session_protocol:2`를 확인한다. 개인 `setup/setup.mjs writing`은 001~004 및 009를 추적 적용하고 고정 사이트/Secrets를 확인한다. 신규 개인도 install/verify 후 같은 명령을 사용한다. 중앙 v2, 기존 소유자 연결, 개인 owner probe와 renewal endpoint의 잘못된 자격 401 응답을 확인한 뒤에만 활성화 파일을 쓴다.
4. 중앙 Pages를 먼저 배포한 뒤, A/B의 기존 config.js·Supabase/중앙 사이트/홈 활성화 설정·소유권 파일을 보존해 새 화면을 빌드/배포한다. 별도 작업 사본의 일반 커밋/push를 사용한다. 개발 작업 사본과 무관한 pipe.sh는 배포하지 않는다.
5. Pages Actions와 제공 파일 해시, 배포된 Edge 버전을 확인한다. 실제 A/B 인증·작성·계정 전환·로그아웃과 원래 발급 만료 시각을 실제로 넘긴 자동 갱신을 검사한다. 테스트 ID를 비공개 journal에 먼저 기록하고 그 ID와 본문 접두어가 일치하는 항목만 정리한다. 방문 수는 테스트 방문도 실제 방문이므로 되돌리지 않는다.

## 복구

화면 문제는 배포 전 개인/중앙 Pages 커밋의 런타임을 후속 복구 커밋으로 배포한다. force push나 DB 전체 복원은 하지 않는다. v2 서버는 기존 v1 프로토콜을 지원하므로 이전 화면과 공존한다. 새 화면에서 member-writing-config의 enabled:false는 임시로 회원 작성을 끄지만 중앙 방문자 표시와 기존 로컬 권한은 별개다. 회원 기능이 필요한 경우 이전 v1 화면 전체로 복구한다.

009/004를 적용한 DB에 이전 함수/SQL을 무조건 덮어쓰지 않는다. v2 family·delegation과 새로 생긴 콘텐츠·세션은 보존하고 원인을 수정한 후 순방향 재배포한다. 이미 적용한 SQL의 해시가 다르거나 추적되지 않은 갱신 스키마가 발견되면 설치는 중단한다. 기존 서명키를 재발급해 모든 로그인을 끊는 방식은 사용하지 않는다.

실제 배포 전후 버전과 결과는 [Step 7 기록](verification/member-session-step7/README.md)에 남긴다. 비공개 백업/체크아웃은 `~/.local/state/minihompy-deployment/member-session-20260923/`이며 Git/Pages에는 포함하지 않는다.
