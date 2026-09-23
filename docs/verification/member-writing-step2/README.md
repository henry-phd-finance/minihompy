# 회원 작성자 연결 Step 2 검증

2026-09-23. 중앙 저장소에서 로컬 구현·검증 완료. Step 1 완료 상태를 확인한 후 진행했다.

- 대상: `~/minihompy-central`.
- 중앙 마이그레이션: `supabase/migrations/202609230002_member_writing.sql`.
- 구현: `supabase/functions/identity-api/writing-auth.js`, 로그인별 SID 발급, grant/세션 폐기 및 중앙 로그아웃 페이지 연결.
- 기능: 대상 사이트 한정 60초 증명, S256 PKCE, 일회 교환, 최대 15분 중앙 grant, 상태 확인, 로그인별 폐기.
- 기존 방문자 전용 세션은 방문 인식을 유지한다. 새 회원 작성에는 SID가 있는 로그인 세션이 필요하다.

## 결과

- 중앙 `npm test`: 12개 스위트 통과.
- 신규 인증 증명 검사: 11개 그룹 통과. 위조·만료·재사용·다른 대상·잘못된 PKCE, 정지/소유자 변경, 권한 폐기, 브라우저 DB 접근 차단 확인.
- 중앙 로그아웃 실패·재시도 검사 통과.
- 실제 Chromium + 로컬 SQL/모의 HTTP의 기존 로그인 브라우저 회귀 검사 통과.
- Pages 빌드/artifact 검사 통과.

상세 API와 실행 방법은 중앙 저장소의 `docs/verification/member-writing-step2/README.md`에 기록했다. 기존 암호/토큰 비보관 원칙을 유지하고, 새 중앙 grant도 DB에는 해시만 저장한다.

운영 DB·함수·Pages는 변경하지 않았다. 실제 다중 PostgreSQL 연결 경합과 호스팅 환경 검증은 후속 배포 단계 범위다. 개인 서버 교환/세션/작성 연결은 Step 3 이후에 구현한다. 기능 전체 백로그는 아직 완료 처리하지 않는다.
