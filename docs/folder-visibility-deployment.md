# 폴더·공개범위 설치와 운영 전환

Step 9에서 준비하고 Step 10에서 A→B 순서로 적용·검증한 절차다. [A/B 운영 기록](verification/folder-visibility-step10/README.md). 다른 사이트에도 별도 백업·접근 검증·활성화 조건을 적용한다. 중앙 회원 서버 프로토콜은 바꾸지 않으며 각 사이트의 개인 DB/Auth/Storage 권한을 사용한다.

## 배포 구성과 선행 조건

- DB: `202609240001_content_folders.sql` → `002_content_visibility.sql` → `003_visibility_summary.sql` → `004_photo_media.sql` → `005_photo_media_safeupdate.sql` 순서. 이전 회원 세션·홈/주소·방문 집계 migrations가 필요하다.
- Edge: 최신 `member-writing`(비공개 부모 댓글 검사 포함)와 `photo-media`. 기존 owner-login/visit-counts는 유지한다.
- Secrets: 해당 프로젝트의 `MINIHOMPY_SITE_ORIGIN`, `MINIHOMPY_PUBLIC_KEY`. 기존 회원 사이트 ID/중앙 주소와 visit secret을 보존한다. service key는 Edge 환경에서만 사용한다.
- Pages: 공통 content-access/폴더 관리와 세 메뉴 repository/view, photo-media-client/editor를 포함한 동일 소스의 전체 `_site`. 일부 JS만 교체하지 않는다.
- Storage: 새 private bucket과 서버 전용 registry. 기존 public 원본은 복사·해시 검증·보호된 표시 확인 이후 폐쇄한다.

프로젝트 URL·관리자 UUID·중앙 siteId·Pages 주소·현재 배포/DB 이력을 먼저 대조한다. 공개 설정 `setup/config.json`과 런타임의 프로젝트가 다르면 설치 도구가 중단한다. SQL 이력 누락·해시 불일치는 원본 배포 기록을 확인하고 복구한다. 기존 데이터가 있는 프로젝트에 마이그레이션을 처음부터 무조건 재실행하거나 가짜 완료 이력을 넣지 않는다.

DB 전체(본문·댓글·폴더·회원 세션·설정·방문 수·migration 이력)와 기존 Storage 설정/파일을 비공개 장소에 백업한다. 파일 journal은 저장소 밖 0700 디렉터리, 파일은 0600으로 보관한다. A/B 백업·토큰·journal을 혼용하지 않는다. 비밀값과 실제 비공개 콘텐츠를 검증 기록에 남기지 않는다.

## 신규 설치

기존 `install` → 확인 파일 Pages 게시 → `verify` → `writing` → `home-data` 절차를 따른다. `install`은 현재 소스의 전체 SQL을 해시 추적으로 적용하므로 아래 추가 명령은 적용된 다섯 파일을 재실행하지 않는다. 신규 DB도 media state는 legacy/ready=false로 시작한다.

폴더·사진 보호 준비는 아래 명령으로 실행한다. 005는 실제 Supabase의 safeupdate 제한에 맞춰 동결·보호 상태 UPDATE에 singleton 조건을 붙인다.

사진이 없는 신규 사이트도 empty inventory/copy/protect/close-legacy 및 실제 권한 검사까지 마쳐야 사진 쓰기를 활성화한다. 신규 설치 후 미디어 준비 전에는 사진 쓰기가 차단되는 것이 정상이다.

## 기존 사이트 업그레이드와 서버 준비

```sh
node setup/setup.mjs folder-visibility --config setup/config.json --dry-run
# Step 10에서 해당 개인 프로젝트의 비공개 환경변수를 제공한 뒤 실행
node setup/setup.mjs folder-visibility --config setup/config.json
```

환경변수는 `MINIHOMPY_OWNER_EMAIL`, `MINIHOMPY_OWNER_PASSWORD`, `SUPABASE_ACCESS_TOKEN`이다. dry-run은 로컬 runtime/SQL 파일과 설정을 확인하고 네트워크·파일을 변경하지 않는다. 실제 실행은 관리자 인증 → migration 해시 검증/누락분 적용 → 두 함수 배포 → 없는 사진의 read가 404/no-store/올바른 CORS로 응답하는지 확인한다. 이 probe는 실제 파일 권한 검증을 대체하지 않는다.

도구는 파일 복사·원본 삭제·ready 활성화·Git push·Pages 배포를 수행하지 않는다. 기존 ready=true 사이트의 재실행은 현재 상태를 유지하며 강제 비활성화도 하지 않는다. 함수 배포가 부분 실패하면 동일 소스/프로젝트로 재실행한다. 같은 프로젝트에 대한 설치/전환은 한 운영자만 진행한다. 로컬 중복 실행은 `.minihompy-folder-visibility.lock`으로 차단한다. 강제 종료 뒤 잠금 해제는 실행 중인 작업이 없음을 확인한 뒤에만 한다. SQL도 advisory lock과 migration transaction으로 부분 적용을 방지하며, 서로 다른 디렉터리의 경쟁 실행은 실패할 수 있으므로 재실행 전 이력을 확인한다.

## 사진 전환 순서와 활성화 조건

1. 최신 서버를 준비하되 ready=false를 유지한다. 기존 사진 private 변경은 MEDIA_NOT_READY로 거절되어야 한다. 사진 기능의 일시적인 사용 불가를 허용하는 점검 시간에 진행한다.
2. [사진 전환 도구](photo-media-migration.md)의 dry-run으로 글/파일 inventory와 누락·경로·MIME·용량을 점검한다. inventory --apply가 사진 쓰기를 동결하고 snapshot/백업을 만든다. 진행 중인 저장이 끝난 뒤 잠금을 얻으며 이후 저장을 거절한다. 오래된 Pages에서도 새 파일 업로드와 글 저장을 우회할 수 없는지 확인한다.
3. copy로 새 private bucket에 동일 logical path로 복사하고 바이트/백업 SHA-256을 재검증한다. 글 ID·본문·revision은 보존한다. protect로 mode=protected, ready=false 상태에 들어간다.
4. 최신 전체 Pages 산출물을 배포하고 실제 공개 사진과 관리자 보호 조회를 확인한다. 이때도 사진 쓰기/비공개 전환은 막혀 있다. 최신 화면이 실패하면 ready를 올리지 않는다.
5. close-legacy로 원본 버킷을 private로 바꾸고 기존 원본을 Storage API로 정리한다. journal closed, 모든 대상 파일 해시, 기존 bucket private, 원본 inventory가 빈 상태인지 재확인한다. 늦게 생긴 파일이 있으면 전환을 중단하고 원인을 확인한다.
6. Step 10의 실제 Auth/Storage/Edge 검사를 통과한다. 예전 public URL을 새로운 클라이언트로 요청해 origin/CDN에서 파일을 새로 받지 못하는지 확인한다. 인증 없는 새 bucket download/list/sign/transform 우회도 검사한다. 유효한 옛 signed URL이나 CDN 신규 제공이 남으면 활성화를 보류한다. 이미 다운로드한 사본의 회수 불가능성은 별도로 기록한다.
7. 위 근거를 기록한 운영자만 DB의 `private.photo_media_state.ready`를 true로 변경한다. mode=protected 제약만으로 실제 Storage 폐쇄가 증명되지는 않는다. 활성화는 준비 도구가 자동 실행하지 않는다. 개인 관리자/비회원/A→B 방문으로 양방향 공개범위·사진·댓글·홈·달력을 검사한 뒤 점검을 종료한다.

ready=true 이전에 공개 원본을 남긴 채 사진 나만보기를 허용하지 않는다. 일반 게시판·다이어리 비공개와 댓글/홈 권한은 서버 SQL이 먼저 적용되므로 오래된 Pages에서도 서버 권한을 우회하지 못해야 한다. 중앙 방문자 식별만으로 개인 관리자 토큰을 대신하지 않는다.

## 중단과 복구

| 중단 지점 | 처리 |
| --- | --- |
| migration/함수 배포 | 적용 이력과 코드 해시를 확인하고 같은 버전으로 재시도. 이미 적용된 SQL은 재실행하지 않음 |
| inventory 중 백업 실패 | frozen/ready=false 유지. 완성 journal 유무를 확인하고 같은 파일의 기존 백업과 비교하며 재시도 |
| copy/protect 실패 | 원본 보존, 해시·참조 불일치 원인을 해결. 현재 단계 재시도 |
| 원본 폐쇄/삭제 응답 유실 | ready=false 유지. journal과 실제 Storage inventory를 재대조하여 close-legacy 재실행 |
| Pages 장애 | 보호된 서버 유지, 정상인 보호 조회 버전으로 교체. 옛 공개 URL 버전으로 회귀하지 않음 |
| 활성화 후 장애 | ready=false로 사진 쓰기/추가 비공개 변경을 막고 조사. 이는 읽기 전체 중단 스위치가 아님. 새 private 파일·registry·본문을 보존하며 복구 |
| 미첨부 파일/삭제 실패 | registry 상태와 본문 참조를 확인하고 보호된 cleanup 재시도. 불확실한 저장 결과만으로 파일을 삭제하지 않음 |

DB와 Storage는 하나의 트랜잭션이 아니다. 불변 경로·hash receipt·첨부 trigger·삭제 tombstone·전환 journal로 재시도한다. DB snapshot을 되돌릴 필요가 생기면 대응하는 private 파일/registry/본문 버전을 함께 복구한다. 비공개 글을 public으로 바꾸거나 원본 버킷을 public으로 재개방하는 복구는 금지한다.

## Step 10 기록할 운영 검증

- A/B 각각 프로젝트·Pages URL, 배포 commit/함수 버전, SQL 해시, 백업/journal 식별자(비밀/내용 제외).
- 비회원/중앙 회원/개인 관리자별 목록·상세·댓글·달력·홈 count와 직접 주소, 폴더 이동/삭제 전후 ID·작성자·revision·댓글 보존.
- A 인증으로 B 관리자 불가, 만료 토큰/로그아웃 시 새 읽기 거절 시점, 브라우저 Blob 폐기. Supabase JWT의 실제 로그아웃 반영 시점과 UI 폐기를 구분.
- private/public/staged/detached/deleted 파일 권한, Storage 직접/서명/변환/list 접근, no-store/CORS, 실제 6 MiB와 동시 4개 읽기, 옛 원본 URL 차단.
- 동시 탭·네트워크 실패·업로드/저장 유실·부분 삭제 복구. 원격 테스트 콘텐츠 정리 후 기존 파일 hash·건수·폴더 연결·방문 수/회원 소유권 대조.

로컬 Step 9는 실제 SQL/handler/중앙 로그인 코드와 브라우저를 사용하지만 Auth·Storage·SQL HTTP transport는 대역이다. 실제 Supabase PostgREST/Auth/Storage/Edge/CDN·GitHub Pages·브라우저별 캐시 동작은 Step 10에서 확인한다.
