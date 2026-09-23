# 회원 작성자 연결 Step 1 검증

2026-09-23. 로컬 PGlite 검증 완료. 운영 DB·함수·Pages는 변경하지 않았다.

## 산출물

- [권한·인증 API 계약](../../member-writing-contract.md): 주체별 권한, PKCE 증명 교환, 15분 개인 세션, 중앙 grant 확인/폐기, API, 제한·충돌·재시도 계약.
- [DB 마이그레이션](../../../supabase/migrations/202609230001_member_writing_foundation.sql): 회원 작성자 필드/제약/인덱스, 직접 회원 DML 제한, 작성자 메타데이터 변경 방지, 비공개 세션·제한·재시도 테이블.
- [검증 스크립트](../../../scripts/verify-member-writing-foundation.mjs).

## 실행 결과

```sh
node scripts/verify-member-writing-foundation.mjs /path/to/pglite/dist/index.js
node scripts/verify-guestbook-db.mjs /path/to/pglite/dist/index.js
node scripts/verify-comments-db.mjs /path/to/pglite/dist/index.js
```

검증 환경: Node 24, 설치되어 있는 `@electric-sql/pglite` 사용. 새 의존성 다운로드는 하지 않았다.

새 마이그레이션 검증 10개 그룹 통과:

1. 이전 마이그레이션 10개 적용 → 기존 공개/비밀 글·댓글 생성 → 새 마이그레이션 적용 후 모든 기존 열 값 비교.
2. 기존 공개/비밀글과 비밀글 댓글의 조회 권한 보존.
3. 브라우저와 개인 관리자의 중앙 회원 필드 주입·재지정 거부.
4. 기존 수정·revision 충돌·주인의 관리 권한·비밀글 재공개 금지 유지.
5. 기존 익명 작성·시간 제한·삭제 동작 유지.
6. 로컬 UUID가 중앙 UUID와 같더라도 회원 글 소유권을 얻지 못함. 기존 직접 관리자 경로의 회원 행 변경 차단.
7. 두 콘텐츠 테이블의 회원/로컬 식별자 혼합·불완전한 회원 필드 거부 및 회원 메타데이터 변경 방지.
8. 기본 grants가 있는 환경에서도 anon/authenticated/service_role의 내부 테이블 조회·삭제 거부. 세션 대상 FK·증명 유일성·해시 형식·수명 제약 확인.
9. 세션·콘텐츠 삭제 후에도 회원 제한 및 재시도 기록 유지, 동일 요청 ID 중복 제한.
10. 중앙 회원용 로컬 auth.users 생성 불필요. 로컬 계정 삭제 후 기존 작성자 NULL 행 보존.

기존 방명록/댓글 DB 테스트도 각각 통과했다. 기존 댓글 테스트는 네 가지 부모와 RLS·cascade·제한을 검증하며, 새 마이그레이션 이후 호환성은 신규 테스트가 별도로 검증한다.

## 검증 한계와 다음 단계

회원 행은 신뢰된 SQL로 테스트 픽스처를 넣었으며, 회원 API 성공을 검증한 것은 아니다. Step 1은 새 회원 쓰기 경로를 열지 않는다. 회원용 트리거/DB 작업 함수와 실제 동시 요청의 원자성은 Step 3~5에서 구현·검증한다. 호스팅 Supabase 인증·gateway와 실제 A/B 통합은 후속 단계 범위다.

계약상 서버 로그아웃과 중앙 grant 검사는 아직 구현되지 않았다. 현재 배포본이 그 동작을 지원한다고 해석하면 안 된다. Step 2부터 중앙 인증 증명을 구현할 수 있다.
