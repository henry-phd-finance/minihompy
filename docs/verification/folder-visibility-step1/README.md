# 폴더·공개범위 Step 1 — 계약과 최소 실증

완료: 2026-09-24. [계약 v1](../../folder-visibility-contract.md), [실행 계획](../../folder-visibility-plan.md).
이번 Step은 설계와 폐기 가능한 로컬 실증이다. 운영용 SQL/Edge/화면 구현, 배포, 운영 DB·사진 파일 변경은 수행하지 않았다. Step 2는 실행하지 않았다.

## 선행 확인

[prerequisites.json](prerequisites.json)에 네 선행 계획의 완료 상태와 최종 검증 문서 해시를 기록했다.

- 회원 작성 Step 7: 운영 배포, 실제 계정, 테스트 정리 및 기존 데이터 보존 완료.
- 회원 이동 Step 6: 중앙/A/B 배포 및 이동·역할 구분·데이터 보존 완료.
- 홈 데이터 Step 7: A/B 배포·홈/주소/방문 검증·데이터 보존 완료.
- 공통 회원 세션 Step 7: 중앙/A/B 배포·실제 15분 만료 경계 갱신·정리/보존 완료.

이전 계획의 오래된 해시를 이후 정상 변경과 비교해 실패시키는 대신, 네 기록을 읽고 이를 이어받은 최신 회원 세션 Step 7 manifest의 개인/중앙 소스 **84/84개 일치**를 확인했다. 이전 운영 배포·보존 JSON도 검토했다. 이번에 원격 운영 상태를 다시 조회하거나 실제 계정으로 로그인한 것은 아니다.

## 확정 사항

- 폴더 RPC의 입력/출력·오류·정렬·재시도와 메뉴별 잠금, 마지막 폴더 유지, 글 이동 후 원자적 폴더 삭제.
- 이동 시 ID/본문/댓글/공개범위/작성일 보존 및 수정 토큰 갱신, 기존 편집기의 폴더 선택 재사용.
- 일반 글 공개/나만보기, 개인 관리자와 중앙 회원 구별, 비공개 부모 댓글의 접근 차단, 방명록 기존 정책 유지.
- 테이블/RLS·서비스 권한 회원 댓글·definer 홈 요약·달력·주소·사진 등 읽기 경로별 변경 위치.
- 비공개 Storage + 개인 서버의 요청별 인증/부모 참조 확인 + 바이트 응답. 브라우저에는 Storage 공개/서명 URL을 발급하지 않음.
- 파일 registry와 임시 업로드/정리 경합, 기존 파일 전환·부분 실패 복구·서버 활성화 조건. 과거 공개 파일 복사본/캐시 회수는 보장하지 않음.

## 실제 실행 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 사진 방식 최소 실증 | 11개 통과 | [prototype.txt](prototype.txt), [prototype.json](prototype.json) |
| 기존 회원 작성 기반 | 10개 그룹 통과 | [foundation.txt](foundation.txt) |
| 기존 회원 댓글 통합 | 9개 그룹 통과 | [member-comments.txt](member-comments.txt) |

최소 실증은 `scripts/verify-folder-visibility-prototype.mjs`로 재현한다. 기존 개인 migration 전체를 PGlite에 적용한 뒤 **실증 전용** 후보 photo visibility/RLS/registry를 추가했다. 실제 `authenticateOwner`를 재사용하고 localhost HTTP에서 실제 PNG 바이트를 주고받았다.

공개 파일 표시, 관리자 전용 사진, 중앙 ID/다른 프로젝트 관리자 거절, 경로 바꿔치기, 없는/숨겨진 파일 응답 일치, 만료/철회 자격, staged 미리보기, 다운로드 도중 범위 변경/인증 제공자의 자격 거절, 삭제/분리된 파일의 접근 차단을 확인했다. 후보 HTTP 서버는 public/sign/list 경로를 제공하지 않는다. 이 검사는 실제 Storage 정책의 차단 증거를 대신하지 않는다. 인증 대역의 토큰 철회는 서버가 인증을 거절하는 상황이며 실제 Supabase 로그아웃이 access JWT를 즉시 무효화한다는 증거가 아니다. 개인 관리자 로그아웃의 DOM/Blob 폐기는 후속 브라우저 검사 대상이다.

서명 URL 대안은 로컬 HMAC과 가상 시계로 만료 전 bearer 재사용, 만료 경계의 origin 거절, 이미 내려받은 바이트의 잔존을 비교했다. 실제 Supabase URL 발급·CDN TTL을 측정한 검사가 아니다. 공식 문서와의 비교 근거는 계약에 링크했다. 채택 경로에는 발급 URL 자체가 없다.

기존 회귀 검사는 수정하지 않은 실제 SQL/handler로 실행했다. 일반 글의 새로운 비공개 댓글 정책을 이 회귀 검사만으로 검증했다고 간주하지 않는다. 그 정책은 Step 4에서 구현·검증한다.

## 재실행

저장소 루트에서 다음을 실행한다. PGlite 경로는 기본값으로 옆 중앙 저장소의 설치된 의존성을 사용하며 인자로 다른 모듈 경로를 지정할 수 있다. 계정 비밀값/환경 .env/운영 네트워크는 사용하지 않는다.

```sh
MINIHOMPY_PROTOTYPE_REPORT=docs/verification/folder-visibility-step1/prototype.json node scripts/verify-folder-visibility-prototype.mjs
node scripts/verify-member-writing-foundation.mjs ../minihompy-central/node_modules/@electric-sql/pglite/dist/index.js
node scripts/verify-member-comments.mjs
```

[source-hashes.json](source-hashes.json)은 선행 최신 소스와 이번 조사/실증 파일의 SHA-256이다. 문서 상태는 해당 계획과 이 기록을 함께 확인한다.

## 남은 검증과 한계

외부 Auth와 Storage는 대역이고 실제 Supabase CDN·브라우저 화면은 이번에 검사하지 않았다. 후보 SQL은 메모리 DB에만 존재한다. 폴더 트랜잭션의 다중 연결 경합은 Step 2, 운영 구현 미디어 처리는 Step 6, 화면 수명·메뉴/인증 변화는 Step 7~9, 실제 Storage 정책/파일 전환/캐시와 A/B 계정은 Step 10의 필수 검증이다. 계약의 해당 절에 체크 범위를 명시했다.

모든 새 검사는 읽기 권한의 미래 구현 방향을 실증할 뿐 현재 운영 사진이 이미 비공개로 바뀌었다는 의미가 아니다.
