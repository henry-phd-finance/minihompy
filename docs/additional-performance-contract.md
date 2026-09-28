# 추가 성능 개선 계약

확정: 2026-09-28, [계획 Step 1](additional-performance-plan.md). 이 문서는 Step 2~13의 구현 계약이며, 현재 구현 완료를 의미하지 않는다. 현재 기준 자료는 [측정 기록](verification/additional-performance-step1/README.md)에 있다.

## 1. 유지할 권한과 표시 순서

본문 → 댓글/달력/사진의 기존 점진 표시, 메뉴 이탈 시 초안 폐기, 자동 회원 갱신, 개인 주인 인증 재사용을 유지한다. 중앙 회원과 개인 Supabase 주인은 서로 다른 주체이다. 표시 캐시를 읽기/쓰기 권한 근거로 사용하지 않는다. 관계 변경 POST, 쓰기 허가, 세션 갱신, 방문 집계 POST는 아래 조회 공유 대상이 아니다.

로그아웃/계정 전환/사이트·프로젝트·중앙 주소 변경/권한 거절은 세대를 증가시킨다. 즉시 보호 DOM·관련 Blob URL을 제거하고 진행 중 권한 조회를 폐기한다. 다음 계정이 이전 계정의 응답을 보지 못한다. 일촌 철회·공개범위 변경·세션 폐기는 서버의 요청별 검사로 처리한다. 준비 상태 30초 캐시가 이 검사를 생략하게 해서는 안 된다.

## 2. 조회 공유·무효화

| 대상 | 공유 키 | 완료 후 재사용 | 무효화/실패 |
| --- | --- | --- | --- |
| 관계 health | 정규화한 개인 API·중앙 API·site ID·설정 세대 | 정상 검증 응답만 완료 시점부터 30초, 메모리 | 설정 전환, capability 불일치, 해당 서비스 오류, 명시적 재시도 |
| 관계 state | 위 설정 키 + 방문자 ID + 대상 ID + 회원 세션 세대 | 없음. 동일 진행 중 요청만 공유 | 관계 변경 시작/완료, 세션 전환/폐기/갱신, 권한 거절, 강제 갱신 |
| 작성자 공개 프로필 | 중앙 API·설정 세대·회원 ID | 유효·활성 응답만 완료 시점부터 30초, 최대 200명 LRU | 기존 navigation/visitor/writing/storage 무효화, 실패·비활성·없음, 직접 재시도 |
| 홈 요약 | 사이트·인증/권한 세대·메뉴 구성·조회 조건 | 추가 결과 캐시 없음 | 콘텐츠/인증/공개범위 변경, 날짜 전환 |

공유 요청은 대기자별 Promise/취소를 제공한다. 한 대기자의 abort는 그 대기자만 취소한다. 전체 무효화 또는 마지막 대기자 이탈 시에만 원 요청을 abort한다. 에러/timeout/취소는 캐시하지 않는다. 실패 재시도는 새 요청이며 무한 자동 반복하지 않는다. 소비자는 health의 각 capability를 별도로 검사한다. 다른 health endpoint의 응답과 섞지 않는다.

홈의 같은 상태 focus/pageshow/visible 이벤트는 trailing 50ms 창에서 묶고, 같은 키의 진행 중 조회가 있으면 합류한다. hidden에서는 시작하지 않으며 dirty 표시만 남긴다. 인증·공개범위 변경은 **즉시** 화면을 비우고 기존 요청을 무효화한 뒤 새 세대에서 조회한다. 글 저장/삭제 후 기존 진행 요청에 합류하지 않고 새 세대로 갱신한다. 분 타이머·한국 시간 자정·직접 재시도·메뉴 이탈은 보존한다. 내용·권한이 동일하면 같은 DOM을 유지해 다른 입력란을 재마운트하지 않는다.

## 3. 작성자 이동의 최신성

30초 캐시는 표시용 이름/handle 등에 한정한다. 정상 클릭 직전에만 fetch하는 구현은 가운데 클릭·우클릭 새 탭·링크 복사에서 우회되므로 채택하지 않는다.

Step 5에서 정적 `author-visit.html?member_id=<UUID>` 중계 페이지를 추가한다. 작성자 이름/집 아이콘의 실제 href는 이 로컬 페이지이며, 목적지 URL·인증 토큰을 query에 넣지 않는다. 중계 페이지가 기존 중앙 `/navigation/members`를 `cache:no-store`, credentials 없이 조회하고, 기존 공개 프로필 파서로 활성 등록·HTTPS 목적지를 검증한 후 `location.replace`로 이동한다. 현재 탭, Enter, Ctrl/Cmd 클릭, 가운데 클릭, 우클릭 새 창, 링크 복사 모두 동일 경로를 지난다. rel=noopener noreferrer와 Referrer-Policy:no-referrer를 적용한다.

중계 화면은 확인 중/실패·등록 없음/다시 시도/돌아가기만 제공한다. 오류 시 캐시된 주소로 이동하지 않는다. 진행 중 중복 실행은 1건으로 합친다. 재시도에는 성공 캐시도 사용하지 않는다. 대상 URL을 사용자 입력으로 받지 않으므로 임의 redirect 기능이 되어서는 안 된다. 중앙의 기존 공개 조회 API를 재사용하며 새 중앙 endpoint는 필요 없다. 기존 UI의 링크 텍스트·집 아이콘·배치는 유지한다.

## 4. 표시용 사진 규격

| 항목 | 확정 값 |
| --- | --- |
| recipe | `display-v1` (변환 의미가 달라지면 새 버전) |
| 출력 | 정지 WebP, quality 0.82, 긴 변 1200px 이하, 원본 확대 없음 |
| 입력 | 원래 업로드 제한인 6 MiB 이하의 JPEG/PNG/WebP 정지 이미지 |
| 디코드 제한 | 헤더에서 확인한 방향 적용 전후 최대 변 8192px, 최대 24,000,000 pixels, 한 번에 1개 |
| 작업 제한 | 파일당 10초; 취소/초과/미지원이면 파생 생성을 건너뛰고 원본 유지 |
| 저장 조건 | 양수 크기, 원본보다 **엄격히 작은** 바이트 수, 유효 WebP signature·치수·SHA-256 |
| 원본 | 경로/게시글 body/바이트를 변경하지 않음. 원본 보기에도 기존 보호 read 사용 |

새 업로드는 주인 브라우저, 기존 파일은 Step 10 도구의 격리 브라우저에서 같은 변환 모듈로 처리한다. 유료 변환 서비스나 공개 transform URL을 사용하지 않는다. 브라우저 인코더별 바이트 차이는 허용하되 실제 바이트 해시를 기록한다. 동일 source/recipe의 먼저 완료된 정상 파생본을 유지한다.

헤더 검사를 **decode 전에** 수행한다. GIF 전체, PNG acTL, WebP ANIM/ANMF, 불명/손상/다중 프레임 형식은 변환하지 않는다. JPEG EXIF 방향을 적용한 픽셀로 출력하고 EXIF를 다시 복제하지 않는다. alpha는 보존한다. 보존 여부를 확인할 수 없거나 WebP 인코더 미지원이면 원본을 사용한다. 캔버스/bitmap/임시 URL을 finally에서 해제한다. 제한 시간 이후의 늦은 결과를 업로드하지 않는다. 실제 decode 종료가 필요한 경로는 Worker 종료로 자원을 회수한다.

근거: 로컬 forest/lake(800×533)는 0.82에서 각각 약 27%, 33% 작아졌다. 0.90 forest는 더 커져 저장하지 않아야 한다. 작은 alpha PNG도 WebP보다 작아서 원본을 사용한다. 확대 없는 1200px는 현재 확대 화면과 DPR 2의 표시 폭을 수용할 여유를 둔 값이며 모든 고배율 화면의 원본 품질을 보장하는 값은 아니다. PSNR은 수치 참고이고 시각 승인 기준이 아니다. 상세 수치는 `photo-fixture.json`에 있다. Step 7에서 EXIF·애니메이션·제한/실패를 자동 검증해야 한다.

브라우저 API 근거: [createImageBitmap의 방향 처리](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap), [toBlob의 품질 인자와 미지원 형식의 PNG fallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob). 따라서 요청한 MIME만 믿지 않고 반환 blob과 magic bytes를 검사한다.

## 5. SQL 연결과 파일 수명주기

새 migration으로 `private.photo_asset_variants`를 추가한다. 기존 `private.photo_assets`는 원본 기준이다. 최소 필드:

- `id` UUID, `source_path`, `post_id`, `source_sha256`, `recipe`.
- 서버 생성 `storage_path`, `sha256`, `size`, `mime`, `width`, `height`, `created_by`, `created_at`.
- `state` = pending / ready / deleting / deleted, `operation_id`, `lease_expires_at`, `updated_at`.
- source_path + source_sha256 + recipe의 활성 예약/완료는 최대 하나. 원본 path/post/해시 연결을 매 전이에 재검사한다. 경로는 서버가 생성하는 `variants/<post UUID>/<variant UUID>.webp`; 원본 path validator와 별개이며 사용자가 임의로 지정하지 못한다.

브라우저 anon/authenticated에는 테이블 SELECT/쓰기·Storage 직접 조회를 허용하지 않는다. 기존 RPC의 주인/서비스 권한 경계를 사용한다. 외부 요청에 service role을 넘기지 않는다. DB capability는 실제 migration/함수 준비 여부를 확인한 뒤 노출한다.

순서:

1. 원본 reserve/upload/complete가 끝난 뒤 변환한다. 아직 게시 전인 원본은 같은 주인의 유효한 원본 예약에만 파생 예약을 허용한다.
2. 현재 원본의 owner/post/source hash와 용량을 검증하여 pending 예약(lease 15분). 경로·operation ID는 서버 생성한다. 요청 재실행은 같은 reservation을 재사용한다.
3. overwrite 없이 바이트를 저장한다. 충돌 시 실제 저장 바이트의 MIME/size/hash를 검증한다. 단순 object 존재로 complete하지 않는다.
4. owner 재인증 + 원본 연결/해시/삭제 상태 재검사 후 ready 전환. 원본이 바뀌었으면 파생본을 공개하지 않고 정리 대상으로 남긴다.
5. 원본 cleanup 시작 시 동일 잠금 순서로 원본과 파생본을 deleting으로 fence한다. 글/초안에서 사용 중인 원본은 기존 IN_USE 정책을 따른다. 파생 생성의 complete가 deletion을 되살릴 수 없다.
6. 파생 Storage와 원본 Storage 삭제를 각각 확인한 후 tombstone을 남긴다. 중간 실패는 deleting 상태에서 재시도한다. ready가 아닌 파일은 read 후보가 아니다. 원본 행의 삭제 때문에 파생 파일 경로가 유실되면 안 된다.
7. 만료 pending/deleting은 주인 전용 복구 도구가 재조회하여 정리한다. lease만 보고 살아 있는 업로드를 삭제하지 않으며, expired reservation의 late complete도 거절한다. deleted tombstone은 이번 버전에서 자동 만료시키지 않는다.

파생 실패만으로 원본 업로드/글 저장을 실패시키지 않는다. 저장되지 않은 초안의 원본 정리 때 파생본도 포함한다. 삭제 응답 유실은 operation 상태 조회 후 복구하고 성공 여부를 추측하지 않는다.

## 6. API·권한 hash·호환성

기존 `friend_media_protocol:1`, `photo_check_protocol:1`과 원본 upload/read 계약을 유지한다. 새 health는 DB와 서버가 모두 준비됐을 때만 `photo_variant_protocol:1`, `photo_variant_recipe:'display-v1'`를 추가한다. 조회 집계의 v1 형식을 바꾸지 않는다.

### 생성과 정리 (Step 7)

새 주인 전용 `photo-media/variant-upload`: multipart 필드 `file,post_id,path,source_sha256,recipe`. path는 원본 경로이다. recipe는 display-v1만 허용한다. 서버는 정지 WebP 여부와 1200px 한도를 검사하고 파일 size/hash/MIME/치수를 직접 계산하며 원본과의 바이트 절약을 확인한다. 원본/파생의 경로를 혼용하거나 회원 token으로 업로드할 수 없다. 응답은 원본과 연결된 opaque variant ID·상태만 제공하고 Storage URL은 제공하지 않는다. reserve→immutable upload→complete는 위 SQL 상태 전이로 묶는다. 기존 cleanup 요청은 원본 paths 그대로 받아 연결 파생본도 정리한다.

### 목록 확인과 읽기 (Step 8~9)

- 기존 `/content/photo-check`의 v1 `{posts:[{id,revision}]}`는 그대로 지원한다.
- capability가 있는 새 요청만 `{posts:[{id,revision}],variant:'display-v1'}`를 보낸다. 여전히 최대 2개 글이며 엄격한 필드 검증을 한다.
- 응답은 현재 읽을 수 있는 각 원본의 descriptor를 제공한다: `post_id,revision,path,source_sha256`, 그리고 ready 파생이 있으면 `representation:{kind:'display-v1',sha256,width,height,size}`. 없으면 representation=null. 비공개 파일 메타데이터를 비권한자에게 노출하지 않는다.
- 파생 read는 `photo-media/read`에 `{post_id,path,representation:{kind:'display-v1',source_sha256,sha256,revision}}`를 보낸다. 원본 read는 기존 `{post_id,path}` 그대로이다. 서버는 DB에서 실제 Storage 경로를 해석하고 요청 descriptor와 현재 연결·revision·source/variant 해시를 대조한다.
- 중앙의 `relationships/read-context`는 이미 **불투명한 canonical request_hash**를 서명한다. 새 중앙 프로토콜은 필요 없다. 개인 함수와 SQL 양쪽에서 member photo read의 canonical selectors에 위 representation 전체, post_id/path를 포함한다. photo-check의 hash는 전체 posts 배열 + variant를 포함한다. 기존 `protocol, mode, scope, action`, site ID·request ID·actor·session·revision·expiry 바인딩은 유지한다.
- read는 권한/연결 검사 → bounded Storage 다운로드 → 크기/MIME/해시 검증 → 최신 중앙 관계 context와 최종 SQL 연결/세션 재검사 순서다. 이 전후 검사 모두 **같은 representation**에 묶인다. 중간 철회/나만보기 전환/원본 삭제/세션 폐기 시 바이트를 반환하지 않는다.
- `private, no-store`, Vary, CORS, Range 거절, body/timeout 제한을 유지한다. 파생 경로·공개/서명 URL·service key를 클라이언트에게 반환하지 않는다. Blob은 기존 화면 수명과 권한 세대에만 유지한다.

| 조합/상태 | 동작 |
| --- | --- |
| 구 클라이언트 + 새 서버/DB | 원본 계약 그대로 |
| 새 클라이언트 + 구 서버 | capability 부재 확인 후 원본 계약. 새 필드 전송 안 함 |
| 새 서버 + 구 DB | 파생 capability 제공 안 함. 기존 원본 기능 유지 |
| 파생 미생성/변환 제외 | photo-check가 권한 확인 후 null descriptor → 기존 보호 원본 read |
| 파생이 선택된 뒤 401/403/404/409, 무결성/중앙 오류 | 원본 자동 재시도 금지. 화면 비움/오류/명시적 재조회 |
| 구버전 또는 파일 생성 실패 | 원본 사용 가능하되 원본의 자체 권한 검사 생략 금지 |

## 7. 편집기와 기존 파일 도구

Step 11: Quill JS/CSS와 필요 편집기 모듈은 주인의 새 글/수정 진입에서만 로드한다. load Promise는 문서 안에서 공유하고 실패 시 버려 재시도 가능하게 한다. 로딩 중 이탈/로그아웃 후 에디터가 나타나면 안 된다. 재진입은 새 빈 초안 또는 선택한 글로 시작한다. HOME/다이어리/사진 **읽기**에는 Quill 요청이 없어야 한다.

Step 10: dry-run 기본, 프로젝트/site/owner 일치 확인 후 명시적 apply. 원본 다운로드는 기존 주인 보호 API, 신규 파생 생성은 같은 variant-upload. 원본 hash를 처리 전후 비교한다. 동시 처리 1개, 파일별 결과/재시작 checkpoint, 실제 원본/토큰은 repository 밖 임시 공간에만 둔다. 이미 ready이면 건너뛰고 실패는 개별 재시도한다. 원본/body/관계/공개범위 변경은 금지한다. 운영 실행은 Step 13에서만 한다.

## 8. 단계별 검증 목록

| Step | 필수 검증 |
| --- | --- |
| 1 | 배포 manifest 62개씩 대조, A/B 6개 역할 조합, 고정 지연/사진 변환 표, 보호 API 기존 회귀 |
| 2 | 동시 health=1, 30초 만료 경계, 오류 미캐시, 설정 교체, 한 대기자 취소/전원 취소, capability 소비자별 검증 |
| 3 | 동시 state=1, 완료 후 새 요청, 타 사이트/회원/세대 분리, 관계 변경·응답 역전·갱신·로그아웃 |
| 4 | 이벤트 burst summary=1, 진행 요청 합류, 쓰기 후 새 세대, 즉시 보호 DOM 제거, hidden/복귀/자정/이탈 |
| 5 | 동일/다수 작성자 배치≤50, 30초·LRU·부분 취소, 비활성/주소 교체, 모든 native 링크 이동 중계·실패 재시도 |
| 6 | SQL 생성/예약 충돌/해시/owner/RLS, 만료·late complete·삭제 경합, original+variant tombstone 복구 |
| 7 | JPEG EXIF 1~8, PNG alpha/APNG, WebP static/animated, GIF, unsupported encoder, 픽셀/용량/시간 제한, 절약 없음, 취소/재시도/원본 저장 성공 |
| 8 | public/owner/friend/nonfriend, path/hash/version/revision 변조, site/session 재생, 다운로드 전후 철회, 중앙 장애, 구 DB/서버, 사진 원본/파생 모두 bytes 검증 |
| 9 | 첫/전체 사진, 원본 보기, 권한 실패 원본 fallback 금지, null descriptor만 정상 원본, 메뉴 이탈 URL 해제, 구 API 호환 |
| 10 | dry-run 무변경, apply 재실행 멱등, 삭제/변경 경합, 중단 재개, 원본 SHA/body 보존, 개인 파일/secret 로그 없음 |
| 11 | 읽기 Quill=0, 첫 편집/재편집 timing, 중복 로드/실패/메뉴 이탈·주인 해제, 사진·다이어리 작성 회귀 |
| 12 | 동일 계측/fixture/캐시 조건 전후, 권한·관계·홈·작성·설치 SQL/패키지, desktop+mobile, p95는 충분한 표본 있을 때만 |
| 13 | A 적용·검증→B 적용·검증, 실제 해시·배포 완료, 승인 범위 내 backfill, 운영 권한/철회/원본 보존·전송량, 설치본 일치 |

요청 수 감소와 권한 검증 생략을 혼동하지 않는다. Step 12/13에서 서버/네트워크 cold start와 캐시/운영 데이터 변화를 분리해서 보고한다. 이번 단일 운영 표본으로 개선율·p95를 주장하지 않는다.
