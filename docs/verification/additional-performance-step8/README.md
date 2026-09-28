# 추가 성능 개선 Step 8 — 표시용 사진의 보호된 서버 읽기

2026-09-28 완료. 선행 Step 1~7 완료 기록과 Step 7 커밋 `1b9589d` 확인. Step 9~13 미착수. 운영 migration/함수 배포/사진 변환/push 없이 로컬에서 작업했다.

## 구현

- `202609280003_photo_variant_reads.sql`은 서비스 전용 `photo_representation_read`와 private resolver를 추가한다. 먼저 기존 **원본 읽기 권한**을 확인한 뒤 원본 path/post/hash, 현재 게시글 revision·본문 연결, ready display-v1 파생본 hash를 대조하여 실제 Storage 경로를 선택한다. 브라우저 입력으로 Storage 경로를 받지 않는다.
- member_photo_read는 representation 전체를 기존 selectors에 포함한다. 기존 중앙 read-context의 canonical request_hash가 `post_id,path,representation` 전체에 묶이므로 중앙 endpoint/서명 코드는 바꾸지 않았다. 모드·scope·사이트·계정·세션·nonce·deadline 검사는 유지한다.
- `/content/photo-check`는 기존 최대 2개 posts/id/revision 형식을 유지하며 `variant:'display-v1'` 요청에만 각 유효 게시글의 `photos` descriptor 배열을 추가한다. 권한 없음/삭제/revision 불일치는 `valid:false,photos:[]`로 동일하게 반환한다. 유효 원본에 준비된 파생본이 없으면 `representation:null`이다. Storage 경로·URL은 응답에서 제외한다.
- SQL은 기존 family/session 승인 → media advisory lock → 게시글/source/variant 순서를 따른다. 원본/파생 수정과 겹치는 조회는 기다린 후 최신 상태를 검사한다. 원본 미디어 준비 상태가 내려가면 파생 조회도 거절한다.
- `representation.js`는 요청 schema와 내부 Storage 선택 결과를 엄격히 확인한다. bounded 다운로드 후 실제 바이트의 size/MIME/hash/WebP 치수를 검사한다. 이후 새 권한·DB 연결 검사로 같은 variant ID/path/source hash/revision/recipe/출력 메타데이터인지 확인한다. 회원은 새 중앙 context와 최종 세션 검사까지 통과해야 바이트를 반환한다.
- 공개/주인/member 경로 모두 전후 검사를 수행한다. 다운로드 중 비공개 전환, 주인 권한 철회, 일촌 해제, 원본/파생 변경, 세션 폐기에 성공 바이트를 반환하지 않는다. Range 거절, no-store, Vary, CORS, 요청/다운로드 상한은 유지한다.

## API 및 호환성

생성 지원인 `photo_variant_protocol:1`과 구분해 **읽기 지원은 `photo_variant_read_protocol:1`**로 확인한다. Step 7 서버는 생성만 지원하기 때문이다. 새 SQL의 상태 함수는 보호 상태 및 필요한 함수 존재를 확인하고, 새 photo-media 및 member-writing health가 read capability를 노출한다. 공유 계약 문서에도 이 구분을 반영했다.

```json
{"posts":[{"id":"<post UUID>","revision":3}],"variant":"display-v1"}
```

응답 `data.items`의 유효 항목 예시:

```json
{
  "id":"<post UUID>","valid":true,
  "photos":[{
    "post_id":"<post UUID>","revision":3,"path":"<original path>",
    "source_sha256":"<source hash>",
    "representation":{"kind":"display-v1","sha256":"<variant hash>","width":1200,"height":750,"size":42000}
  }]
}
```

읽기 요청은 출력 치수/용량을 전달하지 않고 아래 네 필드의 representation만 포함한다.

```json
{"post_id":"<post UUID>","path":"<original path>","representation":{"kind":"display-v1","source_sha256":"<source hash>","sha256":"<variant hash>","revision":3}}
```

- 기존 클라이언트/원본 요청은 원래 JSON·PNG/JPEG/GIF/WebP 계약을 유지한다. 새 DB에서도 representation 없는 요청은 원본 바이트를 반환한다.
- 구 DB/생성 전용 서버는 read capability가 없다. 다음 단계의 클라이언트는 새 필드를 보내지 않고 기존 보호 원본 요청을 사용해야 한다.
- 권한 확인 후 representation=null인 경우만 기존 보호 원본 읽기의 후보가 된다.
- 파생본을 이미 선택한 뒤 401/403/404/409, 무결성·중앙 오류가 발생하면 **원본 바이트로 자동 재시도하지 않는다**. 서버는 오류를 반환한다. 다음 단계의 화면도 명시적 재조회 전까지 비우거나 오류로 남겨야 한다.
- 화면·Blob 캐시·사진첩 선택 로직은 이번 단계에서 바꾸지 않았다. 실제 화면 적용은 Step 9이다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [선택 정보·SQL·호환성](descriptors.txt) | 7개 그룹: public/friend/nonfriend/owner, 비권한 메타데이터 제거, legacy 응답, 모든 selector의 canonical hash 바인딩, strict schema, 구 DB/잘못된 응답 차단, 미생성/deleting null과 선택 후 오류, revision/hash/삭제, ACL, capability/준비 상태 |
| [중앙+개인 API 파생 읽기](friend-variant-api.txt) | 15개 그룹: 실제 중앙/개인 handler·SQL, WebP 바이트, 공개/일촌/비공개·주인, 기존 PNG 요청도 유지, 다운로드 전후 관계 철회·공개범위 변경·로그아웃, source/variant hash·메타데이터 변화, context 재사용, 잘못된 Storage 경로, old read capability, 실제 member photo-check, 주인 철회, loopback HTTP adapter |
| [원본 API 회귀](friend-original-api.txt) | 10개 그룹. 새 서버 코드 + 기존 SQL/원본 PNG 계약, 기존 승인·철회·timeout·취소·HTTP adapter 통과 |
| [PostgreSQL 독립 경합](concurrency.txt) | 파생 모드 5개 그룹: ACL/hash, privacy 전환↔read 잠금, photo-check↔수정/삭제, 원본 unlink, 세션 폐기 및 잠금 중 context 만료 |
| [기존 photo-check](photo-check-legacy.txt) | 7개 그룹. v1 최대 2개 확인/권한/수정·삭제/형식/세션 유지 |
| [기존 사진 API](photo-media.txt) | 11개 그룹. 원본 upload/read/cleanup, 부분 실패·복구, Storage/Auth adapter 유지 |
| [설치 빌드](installer.txt) | 새 함수/migration 포함 171개 파일, hash/추출 후 오프라인 설치·Pages 빌드 검사 통과 |

SQL fixture와 임시 Docker PostgreSQL을 사용한다. 중앙/개인 실제 코드·SQL을 실행하지만 Auth/Storage는 로컬 fixture이며 운영 Supabase 검증은 아니다. 이미지 서버 응답은 실제 WebP/PNG 바이트이다. 초기 loopback fixture는 원본 경로/PNG만 허용해 파생 읽기에 실패했으며, DB가 선택한 파생 경로와 WebP 바이트를 제공하도록 수정 후 전체 통과했다. SQL capability는 추가 함수 존재와 준비 상태까지 검사했다. Node 구문 검사 및 git diff --check 통과.

## 재실행

중앙 저장소의 pg/PGlite 의존성과 Docker가 필요하다. 운영 환경변수/계정을 사용하지 않는다.

```bash
node scripts/verify-photo-variant-reads.mjs
MINIHOMPY_TEST_VARIANT_READ=1 node scripts/verify-friend-photo-api.mjs
node scripts/verify-friend-photo-api.mjs
MINIHOMPY_TEST_VARIANT_READ=1 node scripts/verify-friend-photo-concurrency.mjs
node scripts/verify-photo-check.mjs
node scripts/verify-photo-media.mjs
node scripts/build-installer.mjs
node scripts/verify-installer.mjs
```

중앙 저장소 변경 없음. 설치 적용 순서/운영 배포 검증은 Step 12~13에 남긴다. Step 1 B 초기 식별 오류를 해결했다고 간주하지 않는다. 사용자 변경 `pipe.sh`는 수정/커밋에서 제외했다.
