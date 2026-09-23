# 미니홈피 시각 복원

홈페이지: https://henry-phd-finance.github.io/minihompy/ · [배포 방법](docs/deployment.md)

## 현재 상태

분산 로그인 2단계의 로컬 구현을 완료했다. 중앙 페이지에서 ID를 입력하고, 개인 페이지에서 비밀번호만 입력한 뒤 원래 미니홈피로 돌아온다. [로그인 흐름·개인 함수 설정](docs/login-flow.md), [검수 기록](docs/verification/login-step2/README.md). 운영 적용에는 중앙 v2 인증·사이트 재검증과 개인 `owner-login` 함수 설정/배포가 필요하다.

사이트의 텍스트는 `Dotum, '돋움', sans-serif`로 통일한다. 본문·메뉴·숫자·날짜·편집 폼에 같은 폰트를 쓰며, 보통/굵게·크기·색상으로 구분한다. 추가 자간과 글자 비율 보정은 없다. 돋움은 시스템 폰트이므로 설치되지 않은 기기에서는 대체 글꼴로 표시된다. Windows 폰트 파일은 배포하지 않는다.

내부 원본 크기는 579×349px로 유지한다. 가로 1125px·세로 700px 이상인 창에서는 전체를 1.875배(1085.625×654.375px)로 표시하며 작은 창에서는 기존 1배로 표시한다. 글자·이미지·프레임·우측 탭·로그인 창을 동일 배율로 확대한다.

현재 기능 통합 검수는 [검수 기록](docs/verification/release/README.md)과 `scripts/verify-release.mjs`를 기준으로 한다. 게시판 저장 응답 유실 시 중복 방지 보완에는 `202609130010_board_retry.sql` 적용이 필요하다.

관리자 로그인과 게시판 작성·수정·삭제를 지원한다. 개인 설정은 모두 Supabase DB로 이전했으며, 관리자에게만 우측 맨 마지막에 표시되는 **설정** 탭에서 편집한다. 설정 탭은 숨기거나 순서를 바꿀 수 없다. [현재 설정 방법](docs/configuration.md), [게시판 저장 연결](docs/board-writing.md).

사진첩도 관리자 작성·수정·삭제와 이미지 업로드를 지원한다. 사진 선택 직후 본문에 로컬 미리보기를 넣고, 사진 사이에 글을 쓰며 편집할 수 있다. 저장 시 Supabase에 사진과 본문을 저장한다. [사진첩 저장·권한·파일 제한](docs/photos-writing.md).

다이어리는 날짜·시간·날씨·폴더·텍스트 본문의 관리자 작성·수정·삭제를 지원한다. 달력의 일기 표시와 날짜별 조회도 DB에 연결했다. [다이어리 저장·권한·검증](docs/diary-writing.md).

방명록은 DB 조회, 작성자 수정·삭제, 관리자 비공개 전환을 연결했다. 사용자 요청에 따라 CAPTCHA 없이 첫 작성 시 Supabase 익명 인증을 사용한다. Supabase CAPTCHA는 끄고 익명 인증은 켜야 한다. [방명록 설정·권한·검증](docs/guestbook-writing.md).

게시판·사진첩·다이어리·방명록에 공통 댓글 작성·본인 수정·삭제와 관리자 삭제를 연결했다. 비공개 방명록 댓글도 부모 글의 조회 권한으로 보호한다. [댓글 동작·권한·검증](docs/comments.md).

프로필의 소개는 관리자 사진 업로드·이름·문단 편집과 DB 저장을 지원한다. 기존 설정의 이름/자기소개를 따를 수도 있다. 미확인 프로필 메뉴는 빈칸으로 유지한다. 최초 연결에는 `009_profile.sql` 적용이 필요하다. [프로필 편집·권한·검증](docs/profile-writing.md).

`index.html`을 열면 DB에서 설정을 읽는다. 공개 URL/키는 `supabase-config.js`, 고정된 SDK는 `assets/vendor/`에 있다. 서버·빌드 없이 실행되지만 설정/게시판/사진첩/다이어리 조회와 인증에는 인터넷 연결이 필요하다. DB 오류 시 과거 샘플 설정을 대신 표시하지 않는다.

분산 미니홈피 간 공통 방문자 식별을 지원한다. 중앙 허브 연동 설정은 `visitor-identity-config.js`에 두며, 식별 시 상단 검색창 우측에 방문자 이름이 표시되고 우측 상단 버튼은 공통 방문자 상태(`로그인`/`로그아웃`)와 연동된다. 관리자 기능은 기존 Supabase 인증으로 별도 판정한다. [공통 식별 설계](docs/shared-visitor-identity.md) · [검수 기록](docs/verification/shared-visitor-identity/README.md).

설치·기존 사용자 전환은 [현재 설치 안내](docs/install-and-upgrade.md)를 따른다. CLI는 `install`/`register`/`upgrade`와 Pages 배포 후 `verify`로 나뉘며, 소유권 검증 후에만 중앙 연동 설정을 활성화한다.

## 초기 단계 기록

아래 내용은 정적 복원 당시의 기록이다. config 파일 직접 편집, 로그인/게시판 저장 미구현, API 키 없음 등의 설명은 위 현재 상태로 대체되었다.

다이어리도 D10 기준으로 구현했다. 날짜 막대·폴더 선택·월 이동·일기와 댓글 표시를 지원하며 [diary-data.js](diary-data.js)에 샘플을 둔다. 작성·저장은 여전히 후속 범위다. [구현 기준과 검증](docs/verification/diary-step2/README.md). 아래 초기 단계 기록의 미구현 메뉴에는 이제 다이어리가 포함되지 않는다.

[index.html](index.html)을 브라우저에서 직접 열면 된다. 서버·빌드·패키지 설치 없이 로컬 CSS를 읽는다.

후속 구조 작업 1~4번을 완료했다. [config.js](config.js)에서 문구와 표시 메뉴·순서를 설정하고, 탭을 누르면 왼쪽·본문·선택 표시가 함께 바뀐다. 긴 문구는 고정 영역 안에서 말줄임하며 전체 문구를 툴팁에 제공한다. HOME과 사진첩을 구현했으며 나머지 화면은 아직 빈 영역이다. [설정 방법](docs/configuration.md), [메뉴별 화면 확장](docs/view-structure.md), [통합 검증 결과](docs/verification/integration-step4/README.md)를 참고한다.

사진첩은 2011년 참고 화면의 내부 구성을 기존 master 프레임 안에 맞췄다. 1단계 폴더·구분선, 게시글, 댓글의 정적 표시, 폴더 선택·페이지 이동·내부 스크롤을 제공한다. [photos-data.js](photos-data.js)에 폴더와 샘플 게시물이 있다. 사진·문구는 샘플이며 작성·저장은 지원하지 않는다. [사진첩 구현 기준 및 검증](docs/verification/photos-step2/README.md).

[사진첩 마무리 검수](docs/verification/photos-review/README.md)에서 긴 문구·세로/다중 사진·많은 폴더와 페이지를 검사했다. 다중 사진, 긴 구분선 말줄임, 10페이지 단위 이동을 보완했고 현재 댓글 디자인을 프로젝트 기준으로 기록했다.

작업 1~7의 정적 HOME 시각 복원과 최종 검수를 마쳤다. 579 × 349px 고정 골격에 방문 카운터, 제목, 프로필, 최근게시물, 미니룸, 일촌평, 우측 배너를 표시한다. 원본과 겹쳐 프레임 하단·색상·본문 위치와 역할별 글자 크기를 보정했다. 글자는 HTML이며 그림 네 곳만 참고 이미지의 제한된 영역을 표시한다. 7번 검수에서는 화면을 변경하지 않았다.

- [구현 명세](docs/visual-spec.md)
- [자산 목록](docs/asset-inventory.md)
- [자료 조사](docs/reference-research.md)
- [사진첩 자료 조사 1차](docs/photos-reference-research.md): 조사 당시 근거와 한계, 이후 2011년 내부 구성을 채택한 결정 기록.
- [다이어리 자료 조사](docs/diary-reference-research.md): 16개 이미지 후보와 시기·화면 상태 구분. [이미지 모음](references/diary/index.html). 이후 D10을 채택하여 구현함.
- [작업 4 검증 기록](docs/verification/step4/README.md)
- [작업 5 검증 기록](docs/verification/step5/README.md)
- [작업 6 검증 및 비교](docs/verification/step6/README.md)
- [작업 7 최종 검수](docs/verification/step7/README.md)

화면이 좁으면 문서를 가로로 스크롤한다. 비교용 크기를 유지하므로 큰 화면에서도 좌상단에 작게 표시된다.

## 실행과 범위

`index.html`, `styles.css`, `config.js`, `content.js`, `photos-data.js`, `app.js`, `views/`, `assets/`의 상대 경로를 유지한 채 브라우저에서 HTML을 열면 된다. 로컬 일반 JavaScript로 설정과 화면 정의를 읽으며 외부 CDN, 환경 변수, API 키는 없다. `docs/`, `references/`, `scripts/`는 조사·검증용이며 HOME 실행에는 필요하지 않다. 비교 기준은 브라우저 줌 100%, DPR 1이다. JavaScript를 끄면 공통 외형만 남고 메뉴별 내용은 표시되지 않는다.

탭 클릭과 메뉴별 영역 전환은 동작한다. 일촌신청, 파도타기, 음악 조작부와 HOME 스크롤바는 정적 표시다. 검색은 비활성 상태이며 방문자 수와 게시판 통계는 고정 문구다. 로그인, 글 작성, 댓글·방명록 저장, BGM 재생, Supabase 연결과 GitHub Pages 배포는 구현하지 않았다.

원본 폰트는 확인되지 않아 Galmuri 대체 폰트를 사용한다. 작은 글자의 획·탭 가장자리·말풍선·작은 아이콘의 차이는 남아 있다. 그림 네 곳은 제공된 화면의 제한된 영역을 사용하며 원본 GIF를 복구한 것이 아니다. 공개 배포 전 그림 사용 권리를 확인해야 한다. Chromium의 DPR 1·2를 검사했으며 실제 모바일 기기와 Safari·Firefox는 미검증이다.

## 브라우저 검증

Playwright와 Chromium이 설치된 환경에서 아래 명령 하나로 메뉴·Config 회귀 검사와 긴 문구·빈 값·잘못된 값 검사를 실행한다. 첫 인자는 설치된 `playwright/index.mjs` 경로다. 앱 실행에는 Playwright가 필요하지 않다.

```sh
node scripts/verify-integration.mjs /path/to/playwright/index.mjs
```

결과는 `docs/verification/integration-step4/`에 기록한다. 사용자 Config는 변경하지 않으며 참고 문구·아홉 메뉴를 별도 적용한 캡처가 기존 HOME과 동일한지도 확인한다. 세 글자 이름의 우측 넘침은 해결했다. 메뉴 검사는 현재 Config의 표시 순서를 읽는다. HOME을 숨긴 경우 current 사례는 선택된 화면을 캡처하고 HOME 문구 검사는 별도 설정 사례에서 수행한다. 단일 메뉴도 허용한다.

이전 단계 스크립트는 고정 아홉 탭·클릭 미연결 등 당시 가정을 포함하므로 현재 완료 판정은 위 통합 명령을 사용한다. 기능 구현 이후에는 사진첩·방명록이 비어 있다는 테스트 가정도 해당 화면 내용 검사로 갱신한다.

`scripts/compare-home.mjs`는 저장된 원본·작업 5·작업 6 캡처를 비교하는 별도 도구다. 현재 페이지를 직접 캡처하지 않는다. 기존 단계의 검증·비교 기록은 각 폴더에 보존했다.

분산 로그인 3단계(방문 인식·복귀·로그아웃) 로컬 구현과 검증을 완료했습니다. [검수 결과](docs/verification/login-step3/README.md). 운영 배포는 후속 단계입니다.
