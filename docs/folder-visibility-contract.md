# 폴더·공개범위 계약 v1

확정: 2026-09-24, [실행 계획 Step 1](folder-visibility-plan.md). 이번 문서는 후속 구현의 계약이며 현재 운영 기능을 설명하는 문서가 아니다.
범위: 게시판·사진첩·다이어리 폴더와 일반 글의 공개/나만보기. 일촌 공개·하위 폴더·폴더 공개범위 상속은 제외한다. 중앙 DB에 개인 글·사진·폴더를 저장하지 않는다.

## 1. 선행 조건과 현재 기반

회원 작성 7단계, 회원 이동 6단계, 홈 데이터 7단계, 공통 회원 세션 7단계의 완료 및 운영 보존 기록을 확인했다. 마지막 회원 세션 배포 기록의 개인/중앙 소스 84개가 현재 파일과 일치한다. [검증 근거](verification/folder-visibility-step1/README.md).

현재 `board_folders`/`photo_folders`는 `kind=folder|divider`, `diary_folders`는 폴더만 지원한다. FK는 글이 있는 폴더 삭제를 제한한다. 세 메뉴 편집기의 `folder_id` 선택은 유지하고 별도의 글 이동 전용 화면은 만들지 않는다. 현재 폴더 테이블의 관리자 직접 쓰기를 그대로 허용하면 새 정렬/삭제 규칙을 우회하므로 Step 2에서 권한을 정리한다.

현재 일반 글 조회는 공개이며 사진 버킷은 public이다. 아래 권한·저장소 계약은 새 마이그레이션/함수로 적용한다. 기존 마이그레이션을 소급 수정하지 않는다.

## 2. 폴더와 글 변경 규칙

- 폴더 이름은 trim 후 1~40자, 설명은 현재 설명 열이 있는 게시판/사진첩에 한해 300자 이내다. 중복 이름은 허용하고 ID로 구별한다. 이름/설명은 HTML이 아닌 텍스트로 렌더링한다.
- 폴더는 공개된 분류 정보다. 비공개 글만 있는 폴더도 이름을 숨기지 않는다. 방문자에게 비공개 글의 존재·건수는 노출하지 않는다.
- 정렬은 메뉴별 전체 ID 배열(구분선 포함)을 받아 중복/누락/다른 메뉴 ID를 거절하고 `sort_order=0..n-1`로 원자적으로 저장한다. 새 항목은 마지막에 추가한다. 기존 동일 순서는 `(sort_order,id)`로 결정한다.
- 기존 게시판 구분선은 빈 이름/설명을 유지한다. 사진첩 구분선의 기존 이름/설명은 보존한다. 새 구분선은 빈 값으로 만들고 기존 스키마의 허용 범위에서 편집한다. kind 변경과 다이어리 구분선 생성은 금지한다.
- 실제 폴더가 하나면 삭제할 수 없다. 구분선은 실제 폴더 수에 포함하지 않는다. 기존 0개 상태는 첫 폴더 생성으로 복구하며 업그레이드가 임의 폴더나 글을 만들지 않는다.
- 글이 없는 폴더만 단순 삭제한다. 글이 있으면 같은 메뉴의 다른 실제 폴더로 모든 글을 이동한 뒤 원본을 삭제한다. 공개/비공개 모두 포함하며 일부만 이동한 결과를 커밋하지 않는다. 일괄 글 삭제는 제공하지 않는다.
- 이동은 ID·작성자·본문·댓글·공개범위·created_at·다이어리 날짜/시간을 보존한다. 사진 경로는 폴더가 아닌 글 ID 기반이므로 폴더 이동으로 파일을 복사하지 않는다.
- 이동된 글의 수정 토큰은 바뀐다. 게시판은 `updated_at`, 사진/다이어리는 `revision` 증가와 `updated_at` 변경을 사용한다. 게시판 토큰은 이전 값보다 엄격히 증가하도록 한다. 폴더 이름/순서 변경은 글 수정 토큰을 바꾸지 않는다.
- 목록은 기존 정렬을 유지한다: 게시판/사진 `(created_at desc,id desc)`, 다이어리 날짜 내 `(entry_time,id)`. 폴더 이동으로 최신 글에 새로 올라가지 않는다. 직접 주소는 글 ID를 유지하고 최신 폴더/페이지를 다시 계산한다.

### 폴더 RPC 계약 — Step 2

이름은 `public.manage_content_folders(p_action text,p_args jsonb)`로 통일한다. 메뉴는 `board|photos|diary` allowlist로 실제 테이블을 선택하며 입력 테이블명을 SQL에 삽입하지 않는다. 실행자는 개인 Auth JWT와 `is_minihompy_admin()`을 모두 통과해야 한다. `security definer` 사용 시 빈 search_path와 명시적 객체 이름, 명시적 EXECUTE revoke/grant를 적용한다.

| action | p_args의 추가 필드 | 결과/의미 |
| --- | --- | --- |
| snapshot | menu | 전체 items, 실제 폴더별 모든 글 count, menu_revision |
| create | menu, request_id, expected_revision, id, kind, label, description(지원 시) | 항목 추가 |
| rename | menu, request_id, expected_revision, id, label, description(지원 시) | 이름/설명 수정 |
| reorder | menu, request_id, expected_revision, ids | 전체 순서 변경 |
| delete | menu, request_id, expected_revision, id, destination_id 또는 null | 빈 항목 삭제 또는 이동 후 삭제 |

변경 결과는 `{request_id,menu_revision,affected_id,moved_count}`이며 UI는 snapshot을 다시 조회한다. 공개된 기존 폴더 select는 계속 사용할 수 있지만 관리자 전용 count와 revision은 공개 snapshot에 섞지 않는다.

- menu_revision은 폴더 구조/이름/순서 및 글 생성/삭제/폴더 이동으로 바뀐다. 삭제 확인 후 새 글이 들어왔다면 예전 count를 바탕으로 조용히 삭제하지 않고 `CONFLICT` 후 다시 확인하게 한다. 공개범위/본문만 바뀐 경우 폴더의 전체 글 수는 바뀌지 않는다.
- 폴더 변경과 글 생성/삭제/폴더 이동은 메뉴별 동일 트랜잭션 잠금을 사용한다. 직접 글 쓰기도 statement-level BEFORE trigger 등으로 **행 잠금 전에** 같은 잠금을 잡게 해 잠금 순서를 통일한다. 구체 SQL의 경합/교착 상태와 RLS는 Step 2에서 독립 DB 연결로 입증해야 한다.
- 폴더 직접 INSERT/UPDATE/DELETE 권한은 브라우저 역할에서 회수하고 RPC만 사용한다. FK는 유지한다. 기존 글 편집의 직접 저장은 폴더 잠금/유효성 검사를 통과하도록 유지한다. 삭제와 경쟁해 대상 폴더가 사라지면 글 저장은 실패하고 다른 폴더로 임의 저장하지 않는다.
- request_id는 UUID, 동일 관리자/메뉴/요청 ID의 같은 요청 재전송은 기존 ack를 반환한다. 다른 payload는 `REQUEST_CONFLICT`다. 처리 기록은 서버 전용이며 최소 24시간 유지한다. 재실행에서도 관리자 인증을 먼저 확인하고 과거 snapshot/본문은 반환하지 않는다. 기록 만료 후에는 재조회로 복구한다.
- 오류: `AUTH_REQUIRED`, `FORBIDDEN`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `REQUEST_CONFLICT`, `LAST_FOLDER`, `DESTINATION_REQUIRED`. 실패는 전부 롤백한다. 관리자에게만 원인을 자세히 표시한다.
- 폴더 일괄 이동은 관리자 분류 작업이며 다른 작성자 소유권을 취득하지 않는다. 일반 본문 편집은 기존 메뉴별 RLS 조건을 유지한다. 게시판의 기존 author_id 기반 수정 권한도 이번 범위에서 확대하거나 회수하지 않되, folder_id 변경에는 별도로 현재 관리자 검사를 적용한다.

## 3. 공개범위와 역할

일반 글에 `visibility text not null default 'public' check (visibility in ('public','private'))`를 추가한다. 기존 글은 public, 새 글도 기본 public이다. 기존 retry 비교에 visibility를 포함하며 낡은 revision/updated_at으로 공개범위를 덮어쓰지 않는다. 주인은 일반 글을 공개↔나만보기로 변경할 수 있다. 관리 대상 글의 공개범위 변경과 폴더 이동 권한은 관리자에게 주되, 본문/작성자 권한을 확대하지 않는다.

| 동작 | 비로그인 | 개인 익명 Auth 작성자 | 중앙 회원 | 해당 홈 개인 관리자 |
| --- | --- | --- | --- | --- |
| 폴더 이름·공개 일반 글 읽기 | 허용 | 허용 | 허용 | 허용 |
| 폴더 관리·일반 글 작성 | 불가 | 불가 | 불가 | 허용 |
| 일반 글 나만보기 읽기·범위 관리 | 불가 | 불가 | 불가 | 허용 |
| 공개 글 댓글 읽기 | 허용 | 허용 | 허용 | 허용 |
| 공개 글 댓글 작성·자기 댓글 수정 | 기존 비회원 인증 후 | 기존 자기 소유권 | 검증된 회원 세션 | 기존 작성 주체/소유권 |
| 공개 글 다른 사람 댓글 삭제 | 불가 | 불가 | 불가 | 허용 |
| 비공개 일반 글의 댓글 읽기/변경 | 불가 | 불가 | 자기 댓글이어도 불가 | 읽기·관리 삭제 허용, 본문 수정은 자기 소유만 |
| 공개 홈 요약 | 공개 데이터만 | 공개 데이터만 | 공개 데이터만 | 공개 데이터만 |
| 비밀 방명록·그 댓글 | 기존 정책 | 해당 글 작성자면 허용 | 해당 글 작성자면 허용 | 기존 관리 권한 |

중앙 회원과 개인 관리자가 동시에 존재할 수 있다. 관리자 여부는 현재 사이트의 개인 Auth 세션과 서버 관리자 테이블로 판정한다. 중앙의 member ID, 표시 이름, 클라이언트 role, 자기 홈 표시만으로 승격하지 않는다. A의 Auth 토큰은 B의 관리 증명이 아니다.

방명록의 비밀글은 일반 글의 나만보기와 다르다. 기존 주인/작성자 읽기, 작성자의 본문 편집, 주인/작성자 삭제 및 공개→비밀 전환만 허용하는 규칙을 유지한다. 비밀→공개 허용으로 확대하지 않는다. 중앙 회원에게 기존 익명 소유권을 이전하지 않는다.

부모 공개범위 검사는 댓글 조회/count/create/update/delete와 재시도 결과 반환 **모두**에 적용한다. 일반 댓글 RLS, 직접 쓰기 trigger 및 service-role 회원 RPC를 각각 검증한다. 부모 행 잠금과 현재 권한 확인을 같은 트랜잭션에서 수행해 비공개 전환과의 순서를 결정한다. 먼저 정당하게 승인된 작업은 회수하지 않지만 전환 커밋 후 새 요청은 거절한다.

## 4. 읽기 경로와 화면 상태

| 경로/현재 파일 | 적용 계약 | Step |
| --- | --- | --- |
| `board-repository.js`, `photos-repository.js`, `diary-repository.js` → 일반 테이블 | 목록/상세/정확한 count에 동일 RLS, 쓰기·retry에도 visibility 포함 | 4, 7, 8 |
| 폴더 select, 신규 관리 RPC | 이름은 공개; 전체 count/변경은 관리자만 | 2, 3 |
| `diary_written_dates` → 달력 | 현재 조회자가 읽는 글 날짜만 | 5, 7 |
| `home_summary` / `private.home_summary_at`, `home-repository.js` | definer 우회와 무관하게 세 종류 글 visibility='public', 댓글도 부모 공개 필터 | 5 |
| `post_location`, `post-location-repository.js`, `post-routes.js`, `app.js` | 권한에 맞는 목록과 같은 client/정렬/count로 위치 계산, 숨김/없음은 같은 응답 | 5, 7, 8 |
| `can_read_comment_parent`, 댓글 RLS/guard, `comments-repository.js` | 부모 읽기 권한과 기존 작성자 조건의 교집합 | 4 |
| `member_comments`, `member-writing/handler.js` | service_role 경로에서 명시적 부모 검사, identity-only 불허 | 4 |
| `guestbook-repository.js`, `member_guestbook`, `guestbook_post_location` | 기존 비밀글 정책 유지, 일반 visibility 정책 적용 금지 | 회귀 |
| `photo-editor.js`, `views/photos.js`, Storage public/getPublicUrl | 아래 photo-media 조회로 교체, 임시 미리보기도 보호 | 6, 8 |
| `visitor-session.js`, `admin-auth.js`, `member-writing-runtime.js` | 개인 관리자와 중앙 회원의 독립 상태, late response 폐기 | 7, 8 |
| `home-activity.js`, `views/home.js`, `visit-counts` | 쓰기 후 요약 무효화; 폴더/권한/갱신을 새 방문으로 집계하지 않음 | 5, 9 |

일반 콘텐츠 reader는 `MinihompyVisitorSession.context()`와 같은 검증된 로컬 context에서 client를 선택한다. 관리자면 admin client, 나머지는 visitor client다. 중앙 회원 준비를 기다려야 공개 글을 볼 수 있는 구조로 만들지 않는다. 조회 도중 관리자 검증 실패 시 이전 관리자 client로 계속 조회하지 않는다.

페이지 선택·달력·댓글·사진 요청은 site/메뉴/인증 세대에 묶는다. 로그아웃/계정 전환/메뉴 이탈 시 세대를 올리고 진행 요청 취소, 비공개 DOM·메모리 캐시·미리보기·object URL을 폐기한다. 취소가 실패해 응답이 도착해도 이전 세대의 응답을 표시하지 않는다. history/bfcache/pageshow 재진입 시 권한을 확인하고 재조회한다. 비공개 본문/Blob을 localStorage·sessionStorage·Cache API에 저장하지 않는다.

중앙 계정 전환 시 화면/입력은 정리하지만 독립된 개인 관리자 세션을 임의 로그아웃시키지는 않는다. 남아 있는 개인 관리자 인증이 유효하면 재조회 후 권한을 다시 얻는다. 같은 화면의 정상 자동 인증 갱신은 초안·포커스를 유지한다. 다른 메뉴로 떠나면 미저장 입력을 폐기한다.

관리자가 아닌 호출자에게 숨겨진 글/사진과 없는 항목은 동일한 NOT_FOUND/null을 반환한다. 응답 본문·건수·폴더/날짜 정보가 구별되지 않아야 한다. 정밀한 응답 시간 동일성까지 보장하는 계약은 아니다.

## 5. 사진 보호 방식 확정

**채택: 새 private 버킷 + 개인 Edge `photo-media`의 요청별 권한 확인 + 이미지 바이트 응답.** 공개 글도 이 경로를 사용한다. 브라우저에 Storage 공개/서명 URL을 발급하거나 redirect하지 않는다. 이미지는 fetch → Blob → `URL.createObjectURL()`로 표시하고 수명 종료 시 revoke한다. 서버 응답과 fetch는 no-store이며 서비스 워커에 보관하지 않는다.

서명 URL은 발급 시 권한이 있어도 이후 URL을 가진 사람이 사용할 수 있다. 특히 Supabase 문서상 서명 만료와 CDN 캐시 수명은 별개여서 만료만으로 이미 캐시된 응답을 회수할 수 없다. 이 때문에 60초 서명 URL도 이번 나만보기의 접근 차단 기준으로 사용하지 않는다. [Supabase Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn), [다운로드 방식](https://supabase.com/docs/guides/storage/serving/downloads). 확인일 2026-09-24.

### 저장과 API — Step 6

- 새 버킷 `minihompy-photos-private`는 처음부터 private이다. 브라우저 역할의 Storage select/list/insert/update/delete/sign 권한을 부여하지 않는다. 기존 public 버킷 정책과 섞지 않는다. service-role은 개인 서버에만 보관한다.
- 논리 경로는 기존처럼 `<post UUID>/<image UUID>.<jpg|png|webp|gif>`를 유지한다. 물리 bucket은 서버 전용 registry에서 결정하고 사용자가 bucket/URL을 지정하지 못하게 한다. 다른 bucket URL이므로 기존 public URL과 구별된다. 덮어쓰기는 금지한다.
- 서버 전용 `photo_assets` registry는 path, post_id, 업로드한 local owner ID, bucket, 상태(`staged|attached|deleting`), 크기/MIME/해시, 생성 시각을 관리한다. 공개 SELECT 권한은 주지 않는다. 현재 파일의 실제 본문 image block 참조도 검사한다.
- `POST photo-media/read` body `{post_id,path}`. 공개 첨부는 Authorization 없이 허용한다. 나만보기/미저장 staged 미리보기는 해당 프로젝트에서 검증한 관리자 Bearer가 필요하다. 잘못된 인증이 명시되면 조용히 익명으로 낮추지 않는다. 중앙 작성 증명이나 사용자 ID는 관리자 자격으로 받지 않는다.
- owner 검증은 기존 `authenticateOwner`의 해당 프로젝트 Auth `/user` + `is_minihompy_admin` 확인을 재사용한다. 클라이언트 JWT payload만 decode하거나 service_role 조회 결과만으로 주인을 판정하지 않는다.
- 첨부는 실제 부모 공개범위와 body의 정확한 경로 참조가 일치해야 읽는다. staged는 업로드한 관리자만 미리보기 가능하다. deleting은 누구에게도 제공하지 않는다. 경로 문자열만으로 읽기·Storage 서명 권한을 주지 않는다.
- Storage 다운로드를 서버에서 끝낸 뒤 권한/본문 참조/자격을 다시 확인하고 바이트를 전송한다. 길이 최대 6 MiB, PNG/JPEG/WebP/GIF만 허용한다. 공개범위 변경이나 서버에서 확인되는 인증 무효화 후 시작된 요청을 차단하며 마지막 확인 전에 진행 중인 변경도 잡는다. 최종 확인 후 이미 송신 중인 바이트까지 회수하지는 않는다.
- 성공 응답은 올바른 image MIME, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Vary: Origin, Authorization`. 요청 Origin은 설정된 사이트와 대조하되 CORS를 권한 판정으로 사용하지 않는다. GET/HEAD/Range/변환/임의 fetch URL을 별도 우회 경로로 제공하지 않는다. 공개 read는 프로젝트 공개 key가 요구되는 배포 환경에서도 동작하도록 개인 Pages 설정을 사용한다.
- `POST photo-media/upload`는 관리자 Bearer + 제한된 multipart(post_id,path,file), `POST photo-media/cleanup`은 관리자 Bearer + paths(최대20)를 받는다. 임시 업로드도 public 버킷을 거치지 않는다. 일반 서버의 크기·MIME·magic bytes·경로 검사와 요청 제한을 적용한다.
- 업로드 전에 staged registry를 예약하고 서버가 Storage에 쓰며, 응답 유실 재시도는 경로/해시가 같을 때만 성공으로 취급한다. 글 저장 트랜잭션은 registry의 존재/완료 상태·본인 글 경로를 검사하고 첨부 상태를 전환한다. 다른 글의 파일 재사용을 거절한다.
- cleanup은 DB 잠금 아래 미참조임을 확인하고 먼저 deleting으로 표시한다. 글 저장은 deleting을 첨부할 수 없다. Storage 삭제 후 registry를 정리한다. DB와 Storage의 분산 트랜잭션을 가정하지 않으며 중간 실패는 journal/재시도로 복구한다. 저장 결과가 불명확하면 미사용이라고 추측해 지우지 않는다.
- 기존 글 수정에서 분리된 이미지·글 삭제 뒤 파일 정리도 같은 절차를 따른다. 기간만 보고 일괄 자동 삭제하는 별도 작업은 이번 범위가 아니다.

이미지를 별도 Edge로 전달하므로 요청 수·서버 대역폭 비용은 증가한다. 클라이언트는 화면에 필요한 이미지만 제한된 동시 요청(최대4개)으로 읽고 같은 화면의 메모리 Blob을 재사용한다. Storage의 공개 CDN을 되살리는 최적화는 하지 않는다. 실제 6 MiB 파일과 동시 표시의 Edge 제한은 Step 10에서 검증한다.

### 브라우저와 만료

채택 방식에는 발급 URL의 TTL이 없다. 인증 토큰 만료/권한 변경을 서버 read마다 검사한다. 관리자 만료 시 기존 관리자 인증 흐름으로 처리하고 중앙 회원 세션으로 대체하지 않는다. 현재 화면에서 명시적으로 로그아웃하면 Blob을 즉시 폐기하고, 재로그인 후 새로 읽는다. 단, 개인 Auth의 로그아웃과 이미 발급된 access JWT의 즉시 무효화는 동일하지 않다. 서버가 아직 유효하다고 인정하는 JWT 복사본까지 즉시 거절한다고 약속하지 않는다. 기존 개인 Auth의 만료/검증 의미를 유지하며 실제 로그아웃 이후 토큰의 거절 시점은 Step 10에서 기록한다. 서버 검증 실패와 화면 로그아웃 정리는 별도로 검사한다. [Supabase Auth 세션·JWT 주의사항](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

이미 전송·다운로드·캡처된 데이터는 회수할 수 없다. 다른 탭/외부 방문자가 이미 보고 있는 화면도 서버가 강제로 지울 수 있다는 보장은 하지 않는다. 로컬 화면의 권한 변경 통지/재진입에서는 재조회하고 새 네트워크 요청은 최신 권한을 따른다.

## 6. 기존 파일 전환과 활성화 순서

운영 전환은 Step 10에서만 한다. 각 사이트마다 다음 절차를 journal에 남긴다.

1. 기존 DB 본문/파일 inventory와 해시·크기·참조, 버킷 설정을 비공개 백업한다. 공개 글이라도 첨부 원문과 키를 저장소에 커밋하지 않는다. 누락/중복/의심스러운 경로는 보고하고 진행을 멈춘다.
2. 새 private 버킷/registry/호환 서버를 준비한다. 기존 공개범위는 public이고 private 저장은 서버의 준비 상태 검사로 막는다. UI 숨김만으로 비공개 설정을 막지 않는다.
3. 사진 저장/업로드/삭제를 서버에서 일시 정지하고 모든 기존 사진을 새 버킷에 복사한다. 콘텐츠 해시와 참조 수를 확인하며 실패 시 재개한다. 복사 중 원본을 삭제하지 않는다. 본문 논리 path와 글 ID는 유지한다.
4. registry와 새 읽기 경로를 활성화하고 신규 Pages로 공개 사진이 표시되는지 확인한다. 구 Pages의 public URL fallback은 새 코드에 두지 않는다. 콘텐츠 손실 없는 일시적 읽기 중단은 허용하고 우회 공개 경로는 허용하지 않는다.
5. 기존 public 버킷을 private로 바꾸고 쓰기를 폐쇄한다. 검증된 백업과 새 파일을 확인한 후 Storage API로 원본을 삭제하여 기존 CDN 경로도 무효화한다. DB의 storage.objects만 직접 삭제하지 않는다. 기존 공개 URL/변환/서명/API 경로의 접근 차단과 CDN 잔존을 실제로 확인한다.
6. 실제 Storage 검사·새 경로·원본 폐쇄가 모두 완료된 후 사이트별 ready를 설정해 private 저장과 사진 쓰기를 허용한다. 일반 글 visibility를 적용했지만 미디어가 준비되지 않은 중간 상태에서는 사진 private insert/update를 서버가 거절한다.
7. 마지막으로 무결성과 기존 데이터 보존을 재확인한다. 다른 사람이 활동하는 데이터는 사전 snapshot과 구별한다. 테스트 파일/글만 정확한 ID와 journal로 정리한다.

기존 public URL은 장기 브라우저 캐시를 가질 수 있다. 버킷 전환/원본 삭제 후에도 이미 보유한 캐시는 회수할 수 없다. 운영 보고서에는 확인한 origin/CDN 신규 요청 차단과 회수 불가능한 과거 복사본을 구분한다.

복구는 새 보호 경로를 유지하거나 사진 제공/쓰기를 중단한 상태에서 재개한다. private 데이터가 생긴 뒤 public 버킷/구 Pages로 롤백하지 않는다. 정합성 실패 시 ready를 내리고 비공개 데이터를 공개로 자동 변경하지 않는다. 재시도는 복사/삭제 완료 이력과 해시를 확인하여 중복·유실을 피한다.

## 7. 실증 범위와 후속 필수 검증

[최소 실증](verification/folder-visibility-step1/README.md)은 실제 기존 migration을 적용한 PGlite에 후보 사진 RLS/registry를 추가하고 실제 loopback HTTP로 바이트를 조회했다. 기존 `authenticateOwner`는 재사용하되 외부 Auth/Storage와 시간은 테스트 대역이다. 후보 SQL/서버는 운영 구현이 아니다.

서명 URL 비교는 로컬 HMAC bearer 모델로 만료 전 재사용과 만료 후 이미 얻은 캐시의 잔존을 확인했다. Supabase 서명/CDN 자체를 실험한 것으로 해석하지 않는다. 채택 경로는 서명 URL을 발급하지 않으므로 Step 1의 ‘발급 URL 만료’ 항목은 이 대안 비교와 인증 만료 차단으로 충족한다.

- Step 2: 실제 DB 독립 연결로 정렬/삭제/글 저장 교착·경합, 직접 쓰기 우회, 마지막 폴더 불변식 검증.
- Step 4~5: 실제 운영용 RLS/RPC로 일반 글/댓글·재시도·홈·달력·위치의 전체 권한표 검증.
- Step 6: 실제 구현 registry/Storage adapter로 업로드·cleanup·마이그레이션 중간 실패 검증.
- Step 7~9: 브라우저 Blob 수명, late response, history, 관리자/중앙 세션 조합, CORS, 메뉴 이탈·입력 유지와 설치 검증.
- Step 10: **실제 Supabase** Auth/Storage/Edge에서 private bucket 공개·직접 download·list·sign·변환 요청 차단, 공개/관리자 proxy, staged 보호, 만료/로그아웃/다른 프로젝트 토큰, 캐시 헤더·CDN 우회 없음, 최대 파일·동시 읽기, 기존 URL 폐쇄, 전환/복구 및 데이터 보존을 필수 확인한다. 부족한 항목은 완료로 간주하지 않는다.

## 8. Step 2 구현 상세 (2026-09-24)

구현: `supabase/migrations/202609240001_content_folders.sql`. 운영 미적용. [검증 기록](verification/folder-visibility-step2/README.md).

- snapshot의 items는 각 폴더의 기존 열에 `count`를 추가한다. 구분선 count는 0이다. menu_revision은 비교용 단조 증가 정수이며 이동된 글/정렬된 항목 수에 따라 한 요청에서도 여러 번 증가할 수 있다. 클라이언트는 +1을 추측하지 않고 반환값/재조회값을 사용한다.
- RPC 업무 오류는 `{failure: CODE}`다. anon의 EXECUTE와 폴더 직접 DML/내부 테이블 접근은 SQL 권한 오류(42501)로 차단한다. `authenticated`여도 실제 관리자가 아니면 FORBIDDEN이다. 메뉴 잠금 대기 후에도 관리자 여부를 다시 검사한다.
- rename에서 description 생략은 기존 설명 유지, 빈 문자열 명시는 설명 지우기다. reorder 응답의 affected_id는 null이고 moved_count는 0이다. 동일 값 rename/reorder는 구조 revision을 증가시키지 않아도 요청 ack를 기록한다.
- 트랜잭션 advisory lock의 namespace는 240001, 메뉴 키는 board=1/photos=2/diary=3이다. 일반 글/폴더 INSERT·UPDATE·DELETE의 BEFORE STATEMENT와 RPC가 같은 키를 사용한다. row AFTER trigger가 구조 revision을 갱신한다. 폴더를 바꾸지 않는 본문 편집도 행 잠금 순서를 통일하기 위해 메뉴 잠금을 취하지만 구조 revision은 바꾸지 않는다.
- 테스트 helper `memberWritingDb`는 writing fixture에서 이 마이그레이션도 기본 적용한다. 이전 설치 상태의 업그레이드 검사는 `folders:false`로 시작한 뒤 명시적으로 적용한다. 운영 설치 추적/업그레이드 연결은 Step 9 범위다.
- 미래 visibility 열을 fixture에만 추가해 나만보기 값과 모든 내용이 이동 시 보존되는 것을 검사했다. 일반 글의 비공개 RLS 구현/검증 완료를 의미하지 않으며 Step 4가 담당한다.

## 9. Step 3 화면 연결 (2026-09-24)

`content-folders-repository.js`와 `content-folders.js`를 세 메뉴가 공유한다. 각 메뉴의 어댑터가 변경 후 폴더/목록/글 위치를 재조회하고 선택 폴더를 보정한다. 폴더 관리 중에는 별도 초안 보관을 하지 않는다.

- 주인에게만 관리 진입점을 표시한다. 글 편집/저장 중에는 진입을 막고, 구분선은 게시판·사진첩에만 제공한다. 닫기/취소/Escape, 위·아래 버튼, Tab 순환을 지원한다.
- 삭제 확인에는 서버 snapshot의 전체 count를 표시한다. 글이 있으면 이동 대상을 명시적으로 선택해야 한다. 마지막 실제 폴더의 삭제 버튼은 비활성화하되 서버 검증도 유지한다.
- 변경 충돌은 최신 snapshot을 다시 읽고 이전 삭제 확인을 폐기한다. 잘못된 입력은 수정할 수 있도록 같은 폼에 남긴다. 응답 유실은 저장 성공/실패를 추측하지 않고 동일 request_id/payload의 재확인 또는 명시적 최신 조회를 제공한다.
- 요청 중 같은 동작을 다시 제출하지 못하게 한다. 관리 창을 닫을 때 관련 화면도 재조회해 다른 탭의 변경을 반영한다. 글이 이동되어도 글 ID 주소는 유지하고 최신 위치를 찾는다.
- 로그아웃·계정 전환·메뉴 이탈은 관리 창/입력을 폐기하고 진행 요청을 취소한다. 취소 시점에 서버가 이미 커밋한 변경까지 롤백하지는 않는다. 늦은 응답은 새 화면을 수정하지 않으며 다음 진입에서 폴더를 새로 읽는다. 같은 계정의 정상 인증 갱신은 폼을 유지한다.
- 관리 창은 viewport 안에 표시하며 기존 미니홈피 배율은 변경하지 않는다. 일반 글의 나만보기나 사진 파일 보호는 아직 활성화하지 않는다.

검증: [Step 3 기록](verification/folder-visibility-step3/README.md).

## 10. Step 4 서버 공개범위 구현 (2026-09-24)

구현: `supabase/migrations/202609240002_content_visibility.sql`. 운영 미적용. [검증 기록](verification/folder-visibility-step4/README.md).

### 일반 글과 공개범위 변경 API

세 테이블에 public 기본값의 visibility를 추가한다. 기존 행의 다른 열/작성일/수정 토큰은 업그레이드로 변경하지 않는다. SELECT RLS는 public 또는 해당 사이트 관리자만 허용한다. UPDATE/DELETE에도 같은 접근 범위의 restrictive policy를 추가해 WHERE/RETURNING을 생략한 직접 요청도 숨겨진 글을 수정하지 못하게 한다. 공개 글의 기존 본문 작성자 권한은 유지한다.

`public.set_content_visibility(p_kind text,p_id uuid,p_visibility text,p_expected_version text,p_request_id uuid)`는 개인 관리자 JWT로 호출한다. p_kind는 board/photos/diary, visibility는 public/private만 허용한다. owner_id 같은 클라이언트 주장은 입력으로 받지 않는다. 이전 작성자의 Auth 계정이 없어도 현재 관리자가 공개범위만 관리할 수 있도록 본문 수정과 별도 API로 제공한다.

- board의 expected_version은 REST로 읽은 updated_at 문자열 전체다. JavaScript Date 변환으로 소수 초 정밀도를 줄이지 않는다. photos/diary는 revision의 정수 문자열이다.
- 메뉴 잠금 → 부모 행 잠금 → 현재 권한/수정 토큰 검증 → 변경 순서로 실행한다. 일반 편집과 폴더 이동의 수정 토큰도 함께 충돌한다.
- 결과는 `{id,visibility,updated_at,revision,replayed}`다. board의 revision은 null이다. 실패는 `{failure: CODE}`이며 BAD_REQUEST/AUTH_REQUIRED/FORBIDDEN/NOT_FOUND/REQUEST_CONFLICT/REVISION_CONFLICT/MEDIA_NOT_READY를 사용한다. anon은 함수 EXECUTE 자체가 SQL 권한 오류로 막힌다.
- 개인 관리자/종류/요청 ID별 payload와 결과를 최소 24시간 보관한다. 같은 요청을 재전송하면 최초 결과를 반환하고 다른 payload는 거절한다. 결과는 해당 요청이 처리된 기록이며, 그 후 다른 변경이 없었다는 뜻은 아니다. 화면은 성공/재확인 후 현재 글을 다시 읽는다. 재실행에도 현재 관리자, 부모 존재, 사진 준비 상태를 확인한다.
- 일반 작성 경로에서도 visibility insert/update 컬럼을 허용하지만, 범위 변경은 trigger에서 관리자만 허용하며 기존 본문 author_id RLS는 그대로 적용된다. Step 7~8의 실제 편집 UI에서 visibility를 저장 필드·재시도 비교에 포함하고 기존 수정 토큰 필터와 함께 사용한다. 이번 Step에서는 공개범위 선택 UI와 관리자용 reader를 연결하지 않았다.

### 댓글의 현재 부모 권한과 잠금

공개 댓글 SELECT는 기존 invoker `can_read_comment_parent`를 통해 부모 RLS를 따른다. 쓰기는 별도 volatile `can_write_comment_parent`가 부모를 FOR SHARE로 잠근 뒤 현재 visibility와 개인 관리자/기존 방명록 작성자 권한을 검증한다. UPDATE/DELETE의 USING에서 부모를 먼저 잠그고, INSERT/UPDATE의 BEFORE trigger에서도 quota 처리 전에 확인한다. 공개범위 변경·부모 삭제는 부모 잠금이 풀릴 때까지 기다린다.

서비스 권한 `member_comments`도 일반 private 부모를 owner 모드 이외에는 거절한다. 부모 잠금 뒤 관리자 자격과 회원 세션 만료를 다시 확인하고, 이 검사는 목록/count 및 작성/수정/삭제/과거 요청 재시도보다 앞에 놓인다. 기존 회원 handler는 검증된 회원/개인 관리자 증명을 전달하며 새로운 SQL 결과를 기존 NOT_FOUND/권한 오류 응답으로 변환한다. 방명록은 일반 private 정책과 합치지 않는다.

직접 부모-댓글 수정과 삭제의 잠금 순서를 PostgreSQL 독립 연결로 검증했다. 이번 검증은 실제 화면처럼 한 부모에 대한 댓글 요청, 폴더/공개범위 변경 및 FK cascade 경합을 대상으로 한다.

### 사진 보호 준비 전 차단

서버 전용 `private.photo_media_state`는 ready=false로 시작한다. anon/authenticated/service_role의 직접 테이블 권한을 회수했고, 브라우저용 활성화 RPC는 없다. Step 6~10의 신뢰된 설치/전환 과정에서 실제 파일 보호를 확인한 후에만 true로 설정한다.

photo_posts INSERT/UPDATE의 private 저장은 trigger에서 준비 상태를 읽고 잠근 뒤 검사한다. 공개범위 RPC도 no-op/replay를 포함해 private 요청이면 검사한다. 따라서 UI를 숨기는 것만으로 보호하지 않는다. 로컬 테스트의 ready=true는 테스트 DB fixture에서만 설정하며 운영 사진 버킷이 보호됐다는 의미가 아니다.

**이 migration만 배포하지 않는다.** 홈 요약의 security-definer 집계는 아직 일반 private 필터를 갖추지 않았으며 Step 5에서 연결한다. 메뉴별 관리자 조회 UI·사진 파일 접근 제어도 후속 단계다. 현재 서버 검사 통과를 기능 전체의 비공개 보장 완료로 해석하지 않는다.


## 11. Step 5 — 공개 홈 요약과 호출자별 위치·달력

`202609240003_visibility_summary.sql`이 private.home_summary_at의 부모 CTE에서 세 일반 메뉴 모두 visibility=public으로 제한한다. security-definer wrapper의 권한이나 관리자 인증으로 이 제한이 풀리지 않는다. 최근 5개·메뉴 today/total·오늘 댓글이 같은 부모 집합을 사용하며 기존 v1 응답, 한국 날짜 경계, 숨긴 메뉴, 방명록 정책은 유지한다. 이전 migration은 수정하지 않는다.

`post_location`과 `diary_written_dates`는 기존 security-invoker를 유지한다. Step 4 RLS에 따라 private 글은 방문자의 위치/선행 행 수/날짜에 포함되지 않으며 관리자의 SQL 조회에는 포함된다. 목록 count도 같은 RLS를 적용한다. private ID와 없는 ID는 같은 null 위치 결과다. 주인의 비공개 조회를 실제 화면 client에 연결하는 작업은 Step 7~8에서 한다.

현재 세 화면은 직접 주소와 history 재진입/새로고침 때 위치와 내용을 다시 조회한다. 실제 SQL 연결 브라우저에서 공개→비공개 뒤 재진입, 폴더 이동과 삭제 뒤 새로고침을 검증했으며 이 경로에는 추가 화면 수정이 필요하지 않았다. 다른 탭에서 이미 표시한 공개 콘텐츠를 실시간으로 회수하는 기능은 이번 보장이 아니다. 홈은 기존 갱신 이벤트/주기에 따라 재조회한다.

Step 4에 기록된 홈 집계 필터의 공백은 이 migration으로 해소했다. 사진 파일 보호와 관리자 화면 전환은 미완료이므로 여전히 중간 운영 배포하지 않는다. [검증](verification/folder-visibility-step5/README.md).


## 12. Step 6 — 사진 서버·전환 도구 구현

`202609240004_photo_media.sql`, `supabase/functions/photo-media/`, `setup/photo-media-migration.mjs`와 CLI를 구현했다. [API·상태·복구 절차](photo-media-migration.md), [검증 기록](verification/folder-visibility-step6/README.md).

registry는 최초 첨부 여부(ever_attached)를 추가로 기록한다. 글 삭제/본문 분리 후 staged가 된 기존 첨부를 미저장 미리보기로 다시 노출하지 않는다. cleanup 이후 registry를 완전히 지우는 대신 deleting tombstone을 유지해 불변 경로의 재사용을 막는다. Storage 파일은 삭제하며 메타데이터만 남긴다. 미완료 업로드 예약은 원래 파일 재시도로 완료 여부를 확정한 뒤 정리한다.

mode=legacy/frozen/protected와 ready를 구분했다. protected이라도 ready=false면 사진 쓰기는 정지한다. migration 도구는 백업·복사·새 경로·원본 폐쇄를 순서대로 수행하지만 ready=true로 만들지 않는다. 실제 Storage/CDN/Pages 확인 후 Step 10에서만 활성화한다. 경로·본문·글 ID·revision을 변경하지 않고 bucket/registry로 전환한다.

HTTP read/upload/cleanup은 기존 개인 authenticateOwner를 재사용한다. service-only 전환 RPC는 HTTP에 노출하지 않는다. 업로드/정리는 메뉴 잠금과 registry 상태를 따르고, read는 바이트 다운로드 후 권한을 다시 확인한다. 물리 파일과 DB의 분산 트랜잭션을 가정하지 않으며 삭제 tombstone·재시도로 복구한다. 외부 Storage/Auth는 로컬 대역으로 검증했고 운영 서비스의 보장을 확인한 것으로 해석하지 않는다.


## 13. Step 7 — 게시판·다이어리 공개범위 화면

공개/나만보기 편집·표시와 저장/retry 비교를 연결했다. 자기 글의 본문 수정은 기존 updated_at/revision 조건을 유지한다. 관리자의 별도 공개범위 버튼은 Step 4 RPC로 이전 작성자의 글도 변경하며 본문 수정 권한은 확대하지 않는다.

두 메뉴의 조회는 content-access.js가 검증한 개인 관리자 client 또는 visitor client를 사용한다. 목록/본문/위치/달력을 같은 context로 조회하며 각 요청 전후 개인 관리자 ID와 인증 세대를 확인한다. 중앙 회원 갱신은 관리자 인증을 대체하지 않는다.

개인 계정 변경/로그아웃/검증 실패와 중앙 writing-reset(clearDraft=true)은 초안·비공개 DOM·목록·댓글·달력 표시/날짜·재시도 기록을 정리한다. 같은 개인 계정의 정상 인증 갱신은 초안/포커스를 유지한다. 메뉴 이탈은 초안을 폐기하고 늦은 응답을 무효화한다. 이미 커밋된 저장의 롤백이나 다른 사람이 이미 받은 공개 콘텐츠의 회수를 약속하지 않는다.

저장/삭제/공개범위 변경은 content-changed 이벤트로 공개 홈 요약 갱신을 알린다. 사진 client/Blob 및 이미지 수명은 Step 8에 남겼다. [Step 7 검증](verification/folder-visibility-step7/README.md).


## 14. Step 8 — 사진첩과 보호된 이미지 수명

사진 목록·위치·본문은 검증된 개인 관리자 또는 방문자 context로 조회한다. 공개범위 편집과 변경 RPC는 기존 revision/재시도 계약을 유지한다. photo-media-client는 개인 access token을 Authorization으로 전송하며 중앙 회원 증명을 관리자 권한으로 사용하지 않는다.

이미지는 공개 URL 대신 photo-media POST read의 바이트를 Blob으로 표시한다. 조회 동시 수는 브라우저 전체 4개 이하, MIME과 크기는 제한하며 표시/편집 scope 안에서만 중복 요청을 공유한다. 영구 캐시는 없다. 인증 전환·만료, 메뉴 이탈, pagehide에서 요청 취소·URL 해제·DOM 폐기를 수행한다. 편집 시작의 비동기 다운로드와 로컬 이미지 디코딩에도 세대 검사를 적용한다. 정상적인 같은 계정 갱신에서는 초안을 유지한다.

메뉴 이탈 시 초안은 폐기한다. 저장 제출 전 시도한 업로드는 best-effort cleanup으로 정리하지만 저장 제출 후 결과가 불확실하면 참조 여부를 추측해 삭제하지 않는다. 늦게 완료한 업로드는 이전 편집 세대로 저장을 진행할 수 없다. 서버의 첨부 검사와 삭제 tombstone이 최종 보호를 담당한다. 인증 상실·부분 업로드·네트워크 단절은 staged 파일을 남길 수 있으므로 자동 완전 정리를 보장하지 않는다.

[Step 8 검증](verification/folder-visibility-step8/README.md)은 실제 SQL/handler와 로컬 Auth/Storage 대역을 사용한다. 실제 Supabase Storage/Edge/CDN 및 기존 공개 원본 폐쇄는 Step 10 필수 조건이다.


## 15. Step 9 — 통합 및 설치 경계

별도 A/B 개인 DB와 중앙 로그인 코드로 관리자/중앙 회원/비회원 경계를 검증했다. 설치 준비 명령 folder-visibility는 기존 migration 이력을 검증하고 신규 SQL·두 함수를 준비한다. 원본 전환·ready 활성화·Pages 게시를 자동으로 수행하지 않으며 활성 상태의 재실행은 기존 ready를 유지한다. 신규 설치에도 보호된 파일 전환 완료 전 ready=false를 적용한다. 실제 원본 폐쇄 및 서비스 권한 검증 없이는 사진 비공개를 활성화하지 않는다.

[Step 9 검증](verification/folder-visibility-step9/README.md), [운영 적용·복구 계약](folder-visibility-deployment.md). 로컬 통과는 운영 적용 완료를 의미하지 않으며 Step 10에서 A/B를 각각 확인한다.


## 16. Step 10 — 운영에서 확인한 경계

A/B에 적용하고 실제 Auth/PostgREST/Edge/Storage/Pages를 검증했다. Supabase safeupdate를 위해 migration 005에서 사진 상태 UPDATE 대상을 singleton으로 한정했다. 관리자 초기 확인과 회원 증명 교환의 세대 경합은 관리자 refresh 완료 후 증명을 교환하고 방문 세대를 다시 확인하도록 보완했다.

기존 데이터와 사진 hash 보존, 로그아웃한 JWT의 즉시 401, 비공개 전환 후 신규 읽기 차단을 관측했다. 이미 열린 화면/내려받은 사본은 원격 회수하지 않는다. 실제 검증 범위·실패와 복구·자연 만료 관찰 한계·배포 버전은 [Step 10 기록](verification/folder-visibility-step10/README.md)을 따른다.
