# 홈 최근게시물·게시물 현황 레이아웃 개선

2026-09-24 완료. A/B 실제 홈 스크린샷 검토 후 두 사이트에 반영했다. 홈페이지 전체 배율과 미니룸 위치를 유지했다.

- 최근 목록 폭 120→144px, 우측 집계 86px, 좌우 간격 3→10px로 조정했다.
- 최근게시물과 게시물 현황 제목·구분선을 같은 높이에 맞췄다.
- 집계를 메뉴별 한 줄로 정리하고 오늘/전체 제목과 숫자 열을 정렬했다.
- 글 분류를 작은 배지로 구분하고 날짜를 MM.DD로 줄였다. 전체 제목은 기존 title/접근성 이름에 유지한다.

제품 변경은 home-activity.js와 styles.css 두 파일이다. Step 13 소스 기준의 나머지 파일은 그대로다. 사이트별 설정을 보존한 별도 checkout에서 두 파일만 commit/push하고 Pages를 빌드했다. 일촌 공개 설치 도구의 activate로 실제 제공 release 전체 파일을 대조하고 DB의 Pages hash를 갱신했다. 서버 함수 버전과 DB schema/Secrets는 변경하지 않았다.

검증: 기존 verify-home-activity.mjs의 1280px/375px 6개 그룹(게시물/집계·키보드 이동, 빈 화면/오류/재시도, 세션/메뉴/탭 변경, 늦은 응답과 표시 수명) 통과. 각 사이트 산출물 검증과 실제 제공 두 파일의 SHA-256 대조, 제목 높이·좌우 간격·미니룸 비겹침을 확인했다. 스크린샷은 /tmp/minihompy-home-review/의 A/B-recent-published.png와 A/B-home-published.png에 보관했다. 화면 캡처의 실제 공개 글 내용은 저장소에 추가하지 않았다.

- A: `cd5270c91e9f023a0b8a5db637db6199dd2c6603` · [Pages](https://github.com/henry-phd-finance/minihompy/actions/runs/36014968182)
- B: `d78f227f7edba8906338b0f8256915d5ae629c68` · [Pages](https://github.com/henry-hs-jung/minihompy/actions/runs/36015177579)

[결과](results.json) · [홈 회귀 검사](home-activity.log) · [소스 해시](source-hashes.json). 비공개 배포 journal: /home/henry91-jung/.local/state/minihompy-deployment/home-layout-20260924.
