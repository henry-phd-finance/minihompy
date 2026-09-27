# 홈 집계 세로 중앙 정렬 — 2026-09-26

`styles.css`에서 메뉴 집계 행의 baseline 정렬을 center로 변경. 메뉴 제목과 숫자 줄 높이를 1로 통일하고 N 사각형 내부도 flex 중앙 정렬을 적용했다. 글자 크기, 배지 크기, 색상, 열 폭과 표시 조건은 유지한다.

기존 `verify-home-activity.mjs` 1280/375px 6개 검증 그룹 통과. `/tmp/home-new-align/home-1280.png` 스크린샷 직접 확인.

A/B에는 CSS만 변경하여 배포. 실제 Pages CSS 해시, 홈 표시 조건, dt/숫자/N 요소의 세로 중심 좌표 차이 0.2px 미만 및 콘텐츠 health 확인 결과는 `hosted.json`에 기록한다.
