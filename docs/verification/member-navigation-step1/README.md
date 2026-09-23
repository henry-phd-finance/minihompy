# 미니홈피 이동 Step 1 검증 기록

완료: 2026-09-23. 로컬 구현·검증만 수행했으며 운영 DB/함수/Pages는 변경하지 않았다.

## 선행 조건

[회원 작성 Step 7](../member-writing-step7/README.md)의 중앙/A/B 배포, 실제 계정 검증 및 데이터 보존 기록을 확인했다. 회원 작성 Step 1~7 완료 상태이므로 이번 Step 1을 진행했다. 이번 중앙 전체 회귀 실행에서도 회원 작성·로그아웃·방문자 인증 검사가 통과했다.

## 구현

중앙 저장소 `minihompy-central`:

- `supabase/functions/identity-api/navigation.js`: 사이트 소유자, 회원 ID 일괄 조회, 페이지 목록, 랜덤 대상 읽기 API와 입력 제한.
- `supabase/functions/identity-api/handler.js`: 새 공개 읽기 라우팅, 기존 directory 응답 유지 및 등록 홈페이지 검증 강화.
- `supabase/migrations/202609230003_member_navigation.sql`: 활성·검증된 등록 홈페이지 필터, 회원 UUID 커서 페이지, 전체 후보 랜덤 선택을 수행하는 service-role 전용 읽기 RPC. 회원·사이트 데이터는 수정하지 않는다.
- `scripts/verify-member-navigation.mjs`, `scripts/helpers/identity-db.mjs`, `scripts/verify-all.mjs`: 실제 SQL 기반 검증과 전체 회귀 편입.
- `scripts/verify-identity-directory.mjs`: 검색어 없는 요청이 이제 페이지 목록을 반환하는 계약에 맞게 기존 400 기대값을 교체. 해당 동작은 실제 SQL 검사에서 검증한다.

[API 계약 v1](../../member-navigation-contract.md)에 응답, 오류, 페이지 탐색, 기존 검색 호환성과 배포 순서를 기록했다.

## 결과

중앙 저장소에서 `npm test` 실행: **13개 스위트 모두 통과**.

새 이동 조회 검사 7개 그룹:

1. 마이그레이션 재적용 후 기존 회원·사이트 전체 행의 필드 값 보존.
2. 사이트 소유자와 중앙 회원 ID 대응, 다섯 공개 필드 제한, 세 가지 함수 경로 처리.
3. 회원 ID 일괄 중복 제거, 미등록 ID 제외, 등록 홈페이지 변경의 즉시 반영.
4. 회원 65명 환경에서 정지 회원/사이트·미검증·HTTP·인증 정보 포함 URL·외부 주소·query/hash·역슬래시 주소 제외. 적격 회원 55명을 페이지 크기 7로 모두 탐색해 중복·누락 없음 확인. 기본 20건, 검색, 빈 결과 확인.
5. 전체 후보 대상 랜덤 선택, 현재 사이트 제외, 후보 1개/0개 처리. 재현 가능한 DB random seed 사용.
6. 잘못된 UUID·개수·페이지 크기·중복 조건 거부, CORS/OPTIONS, 메서드 제한, DB 실패의 503 응답.
7. anon/authenticated 역할의 RPC 직접 실행 거부와 service-role 읽기 경로 확인.

나머지 회귀 스위트: 런타임 JS/TS 일치, 배포 사전조건, 토큰 보안, 기존 directory/CORS, 검증된 등록·로그인, 회원 작성 증명·로그아웃, 로그아웃 UI 복구, 기존 데이터 업그레이드, 방문 티켓 발급·해결, 중앙 방문/로그인 UI 경로.

## 재현

```sh
cd ~/minihompy-central
node scripts/verify-member-navigation.mjs
npm test
```

환경: Node.js v24.15.0, 저장소의 PGlite 의존성. 운영 계정 비밀번호·토큰이나 네트워크 배포 권한은 사용하지 않는다.

## 다음 단계와 제한

Step 2부터 개인 화면에서 이 API를 소비한다. 이번에는 ‘내 미니홈피’·파도타기 등 화면 동작을 변경하지 않았다. 운영 적용은 Step 6이며 새 중앙 마이그레이션을 함수보다 먼저 적용해야 한다. 커서 목록은 동시 데이터 변경에 대한 고정 스냅샷을 제공하지 않는다. 실제 일촌 관계는 백로그 5번에 남긴다.
