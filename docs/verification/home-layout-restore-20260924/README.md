# 싸이월드 최근게시물 레이아웃 복구

2026-09-24. 앞선 home-layout-20260924의 디자인 변경을 사용자 요청에 따라 교정했다.

기준: 사용자 제공 assets/cyworld-reference-sprite.png와 [KBS 기사 속 옛 미니홈피 화면](https://news.kbs.co.kr/news/view.do?ncd=5109167). 웹 이미지 검색 후 실제 이미지도 열어 확인했다.

- 추가했던 게시물 현황 제목과 오늘/전체 열 제목을 제거했다.
- 오른쪽 집계를 원래 싸이월드의 두 열 구성과 메뉴명 + 오늘 / 전체 표기로 복구했다. 실제 표시 메뉴 및 집계값을 유지한다.
- 왼쪽 폭을 원본 비율로 되돌리고, 작은 분류표 + 글 제목으로 표시한다. 날짜는 시각적으로 감추고 기존 title/접근성 이름과 time 요소에 보존한다.
- 최근 글 다섯 줄이 영역 안에 들어오도록 행 높이를 맞췄다. 기존 전체 배율과 미니룸 위치는 유지한다.

제품 변경은 home-activity.js와 styles.css 두 파일이다. 사이트별 설정을 보존한 별도 checkout에서 배포했다. Pages 배포 후 activate로 실제 release 파일을 대조하고 DB Pages hash를 갱신했다. 서버 함수 버전은 그대로다.

검증: 기존 홈 기능 검사 1280/375px 6그룹 통과. 두 사이트 산출물 검증, 실제 배포 파일 SHA-256, 2열 집계, 다섯 줄 비잘림, 미니룸 비겹침 확인. 실제 공개 글이 포함된 스크린샷은 저장소 밖 /tmp/minihompy-home-review/A-recent-restored.png 및 B-recent-restored.png에 보관한다.

- A: b7084c696335dbb2ae7a63cf754ba8c511981e82 · [Pages](https://github.com/henry-phd-finance/minihompy/actions/runs/36016668463)
- B: 4db7126596d9460b6611cd4213f68f622eec2ad2 · [Pages](https://github.com/henry-hs-jung/minihompy/actions/runs/36016783293)

[결과](results.json) · [홈 기능 검사](home-activity.log). 이전 레이아웃 검증 기록은 과거 배포 기록으로 유지한다.
