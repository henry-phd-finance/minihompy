# 일촌 공개 Step 6 검증

2026-09-24 완료. [계획](../../friend-visibility-plan.md) · [사진 계약](../../friend-visibility-contract.md#14-step-6-사진-서버-연결).

Step 5 기준 파일 417개가 모두 일치함을 확인했다. photo-media의 명시적 member 읽기를 새 서비스 전용 SQL `member_photo_read`에 연결했다. 기존 무헤더 공개/관리자 해석과 업로드·정리 관리자 전용 정책을 보존했다.

회원 읽기는 파일 조회 전에 중앙 read-context, 개인 session/family, 현재 공개범위, post/path 및 등록된 attached 자산을 확인한다. 최대 6 MiB를 버퍼링하고 size/MIME/SHA256을 검사한 뒤 새 중앙 request/context로 같은 검사를 반복한다. 응답 직전 개인 세션과 마지막 context 기한도 검사한다. 사전 context의 유효시간을 연장하지 않으며 마지막 검사 이후 전송을 시작한 응답의 회수는 보장하지 않는다.

## 검사 결과

| 검사 | 통과 | 근거 |
| --- | --- | --- |
| `node scripts/verify-friend-photo-api.mjs` | 10개 그룹 | [api.log](api.log) |
| `node scripts/verify-friend-photo-concurrency.mjs` | 4개 그룹 | [concurrency.log](concurrency.log) |
| `node scripts/verify-friend-photo-http.mjs` | 5개 그룹 | [http.log](http.log) |
| `node scripts/verify-photo-media.mjs` | 11개 그룹 | [media-regression.log](media-regression.log) |
| `node scripts/verify-photo-media-concurrency.mjs` | 4개 그룹 | [media-concurrency-regression.log](media-concurrency-regression.log) |
| `node scripts/verify-friend-comments-api.mjs` | 10개 그룹 | [comments-regression.log](comments-regression.log) |

API는 실제 중앙/개인 A/B SQL·handler·proof/PKCE·회원 세션을 사용한다. 실제 PNG 바이트를 비교했고 운영용 named REST RPC/Storage 어댑터도 loopback HTTP 서버로 실행했다. 비일촌/대기/일촌/관리자/공개, 다른 사이트 세션, 잘못된 post/path·추가 context·Range·Origin, 일촌 끊기와 재연결, 비공개 전환, 바이트/메타데이터 변조, 중앙 장애/429, 최종 SQL 지연, 다운로드 중 및 최종 SQL 후 로그아웃, 진행 중 요청 취소를 확인했다. 테스트 재신청은 중앙의 60초 방향별 cooldown을 우회하도록 반대 회원이 신청하는 정상 흐름을 사용했다.

PostgreSQL 16 독립 연결에서는 RPC ACL·해시 결합, 공개범위 변경과 읽기의 양쪽 잠금 순서, 부모 삭제 후 남은 파일 접근 차단, 로그아웃 우선과 잠금 대기 중 기한 만료를 확인했다. SQL은 기존 사진 statement trigger와 같은 전역 자산 잠금을 사용하며 부모/파일 잠금으로 현재 연결을 검사한다. 일회용 컨테이너는 정리했다.

HTTP 검사는 정지/초과 크기 body, caller 취소의 fetch/body 전달, 늦은 결과 폐기, CORS/no-store를 확인했다. 스트림 취소가 reader의 done으로 먼저 완료되는 경우에도 취소 오류가 되도록 수정했다. 테스트에서는 짧은 주입 기한을 사용하며 30초/45초 전체 시간을 기다리는 부하 검사는 아니다.

기존 사진 회귀는 비회원/관리자 읽기, staged 미리보기, 업로드·불변 파일·정리, 실제 HTTP 어댑터, 공개범위 재검사, Storage restrictive RLS(추가 permissive grant에도 거절), legacy bucket 폐쇄·서명/쓰기 제한·마이그레이션 복구를 유지한다. API는 private authenticated object GET만 사용하고 public/sign/render/list URL을 발급하지 않는다. 기존 회귀의 Vary 기대값은 새 mode 헤더를 포함하도록 변경했다.

변경 JavaScript 문법 검사 및 두 저장소 diff 공백 검사도 통과했다. [결과](results.json) · [소스 기준](source-hashes.json).

## 범위와 한계

Supabase Auth와 Storage HTTP 서비스는 로컬 fixture다. 실제 이미지 바이트, SQL/RLS, HTTP 어댑터와 독립 PostgreSQL 잠금은 검증했지만 호스팅된 Storage gateway의 sign/transform/list endpoint를 실계정으로 호출한 검사는 아니다. 해당 운영 검증은 Step 13에 남긴다. 기존 브라우저 동시 다운로드 4개 제한은 변경하지 않았고 새 member 사진 클라이언트·blob 수명주기·45초 브라우저 timeout 연결은 Step 10이다.

운영 배포·Secrets·운영 데이터·readiness 플래그는 변경하지 않았다. Step 7~13은 미착수다. 중앙 저장소와 기존 미커밋 변경 및 이전 단계 근거를 보존했다.
