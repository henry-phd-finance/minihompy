# 추가 성능 개선 Step 11 — 사진 편집기 지연 로딩

2026-09-28 완료. Step 1~10 완료 기록과 Step 10 커밋 `033a2bf`를 확인했다. 로컬 구현·검증·설치 산출물 갱신만 수행했으며 운영 배포/push는 하지 않았다. Step 12~13은 미착수다.

## 구현

- `index.html`에서 Quill 2.0.3, `photo-editor.js`, `photo-variant-client.js`의 초기 script를 제거하고 작은 `photo-editor-loader.js`로 대체했다. 공개 사진 조회에 필요한 repository/media/view와 Supabase SDK는 유지했다.
- 주인의 글쓰기/수정 요청에서만 같은 사이트의 고정 Quill 파일과 변환 client를 병렬로 불러오고, 준비된 뒤 편집기 구현을 로드한다. Worker와 형식 검사기는 실제 사진 업로드/변환 때만 실행한다. 별도 CDN이나 최신 버전 URL은 추가하지 않았다.
- 기존 `MinihompyPhotoEditor` 인터페이스는 proxy로 유지한다. 구현의 Quill image 등록과 guard/event 초기화는 지연된 구현 파일에서 한 번만 한다. 기존 독립 편집기 integration의 직접 로딩 API도 유지한다.
- 진행 중 asset 요청과 편집 시작을 공유한다. 성공한 정적 코드는 메모리에서 재사용하고 실패한 asset은 다시 요청할 수 있다. 목록의 상태 영역에 로딩 안내와 명시적 `편집기 다시 시도` 버튼을 제공한다.
- 메뉴 이탈/페이지 이탈/인증 무효화는 시작 세대를 취소한다. 현재 주인·화면 요청·연결된 DOM을 확인한 뒤에만 draft를 연다. 구현이 이미 시작해 권한/원본 사진을 기다리는 중에도 오래된 draft를 정리한다. 이전 요청의 finally가 새 시작을 지우지 않는다.
- 취소된 시도의 **정적 스크립트 다운로드는 끝날 수 있다**. 완료된 코드만 재사용하고 draft/화면은 복원하지 않는다. 메뉴 이탈 시 초안 폐기·Blob 정리, 업로드/실패 복구 정책은 유지했다.
- Pages 검사에 loader/동적 의존 파일의 존재와 초기 script 제외를 추가했다. 기존 전체 JS/HTML/CSS 해시에 동적 파일도 포함된다. 설치 압축을 해제한 상태에서도 같은 Pages 검사를 실행한다.

## 검증

| 검사 | 결과 |
| --- | --- |
| [로딩·취소·측정](loading.txt) | 실제 현재/Step 10 index의 script 목록과 편집기/view 사용. 초기 요청 0, 첫 편집 1회 로딩, 재편집 추가 요청 0/초안 폐기, 중복 클릭, 메뉴 이탈/로그아웃/주인 전환, 각 의존 파일 실패 후 재시도, 방문객 호출 차단, draft 준비 중 취소 등 5개 그룹 |
| [실제 사진 쓰기 UI/SQL/handler](writing.txt) | 1280/375px 총 30개 그룹. fixture의 초기 script 선택도 loader로 바꿔 실제 지연 로딩 사용. 신규/수정/사진 업로드·파생 생성·저장·삭제/복구, 공개범위·계정 전환·메뉴/Blob 정리 유지 |
| [실제 중앙/개인 일촌 사진](friend-browser.txt) | 총 12개 그룹. 지연 로딩 + 실제 파생 read/원본 편집. 주인·회원·방문객, 비공개/관계 철회/중앙 오류, 댓글, 사진 쓰기·삭제·메뉴 초안 폐기 통과 |
| [설치 산출물](installer.txt) | 176개 파일 hash/압축 재현성, 압축 해제 후 설치 dry run/Pages 빌드·동적 의존 파일·전체 release hash 검사 통과 |

최초 로딩 테스트 도구는 빈 상태 문구를 visible로 기다려 timeout이 발생했다. 빈 상태 영역이 정상인 점에 맞춰 DOM 부착을 기다리도록 바꾼 후 통과했다. 실제 SQL/handler 검증의 Auth/Storage는 로컬 fixture이며 운영 계정/콘텐츠는 사용하지 않았다. Node 구문 검사와 git diff --check 통과.

## 측정과 한계

[원자료](metrics.json). 기준은 Step 10 커밋 `033a2bf`의 index와 편집기다. 동일한 격리 화면에서 현재 사진 관련 repository/media/view를 공통으로 사용하고 초기 script 로딩 방식만 비교했다. 홈에는 설명용 placeholder, 사진첩에는 빈 목록을 두고 실제 Quill 편집기를 열었다.

각 방식 3회, 매번 새 페이지, script별 30ms + 2 MiB/s 바이트 지연을 모사했다. 측정 동안 다른 회귀 테스트를 동시에 실행하지 않았다. 첫 편집은 클릭→실제 `.ql-editor` 표시, 재편집은 같은 페이지에서 메뉴 이탈 후 다시 여는 시간이다. 시간은 중앙값, 바이트는 비압축 응답 본문 합계다.

| 항목 | Step 10 초기 로딩 | Step 11 지연 로딩 |
| --- | ---: | ---: |
| 초기 편집기 관련 요청 | 3회 | 0회 |
| fixture 초기 JS 바이트 | 264,925 | 43,941 (220,984바이트 감소) |
| fixture DOMContentLoaded | 154.1ms | 45.8ms |
| 첫 편집 진입 | 39ms | 312ms |
| 재편집 진입 | 33ms | 43ms |
| 재편집 추가 script 요청 | 0회 | 0회 |

초기 다운로드 부담을 편집이 필요한 시점으로 옮겼으므로 첫 편집에는 코드 다운로드 대기가 추가된다. 전체 운영 홈 로딩 시간이나 gzip/CDN 캐시 환경의 개선율로 해석하지 않는다. 실제 A/B 첫 편집·초기 홈 측정은 Step 12/13에서 다시 한다. 디자인이나 Quill 버전을 바꾸지 않았다.

## 재실행

Playwright 모듈 경로를 첫 인자로 전달하고 `CHROMIUM_PATH`를 설치된 Chromium으로 지정한다. SQL fixture는 중앙 저장소의 PGlite를 사용한다. 기준 비교에는 Git 커밋 `033a2bf`가 필요하다.

```bash
VERIFICATION_DIR=/tmp/step11-loading node scripts/verify-photo-editor-loading.mjs <playwright-module>
VERIFICATION_DIR=/tmp/step11-writing node scripts/verify-photo-visibility-ui.mjs <playwright-module>
MINIHOMPY_TEST_VARIANT_READ=1 VERIFICATION_DIR=/tmp/step11-friend node scripts/verify-friend-photos-browser.mjs <playwright-module>
node scripts/build-pages.mjs
node scripts/verify-artifact.mjs
node scripts/build-installer.mjs
node scripts/verify-installer.mjs
```

중앙 저장소 변경은 없고 기존 `pipe.sh` 수정은 제외했다. Step 1에서 남은 B 초기 식별 문제는 이번 단계에서 해결했다고 간주하지 않는다. 다음은 **Step 12 — 설치 연결·통합 회귀·전후 측정**이다.
