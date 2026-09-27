# 시각 복원용 대체 폰트

`Galmuri11-tabs.woff2`는 Galmuri11에서 현재 아홉 탭에 필요한 문자만 남긴 서브셋이다. 원본 싸이월드 폰트로 확인된 파일이 아닌 시각적 대체 자산이다. 본문에는 적용하지 않는다.

- 제작자: Lee Minseo / quiple
- [프로젝트](https://github.com/quiple/galmuri)
- [받은 파일](https://raw.githubusercontent.com/quiple/galmuri/main/dist/Galmuri11.woff2)
- 파일 내부 버전: 2.404
- 수집일: 2026-09-13
- 라이선스: SIL OFL 1.1, [원문](OFL.txt)
- 원본 SHA-256: `8bad9322b3340bfb5cb26cb00f4752bf4c8e7d1b526bb07205f4af458eebed31`
- 서브셋 SHA-256: `d58a9df5503c88fd9bf3a2b9227ac669fbf622c18ed7dc51750332b8e108fc2b`

획·메트릭은 변경하지 않았다. fontTools의 `pyftsubset`으로 아래 문자 집합을 남겼다. 서버의 main 파일은 바뀔 수 있으므로 재생성할 때는 원본 해시를 확인한다.

```sh
pyftsubset Galmuri11.woff2 --text='홈프로필다이어리쥬크박스사진첩갤러게시판동영상방명록' --flavor=woff2 --output-file=Galmuri11-tabs.woff2
```

폰트는 로컬 경로에서 읽으므로 앱 실행 중 외부 CDN 요청이 없다. 새로운 탭 문자를 추가하면 서브셋 문자 범위도 갱신해야 한다. 표시는 HTML 텍스트이며 탭 라벨의 가로 배율만 CSS에서 보정한다.

## 작업 5 본문

`Galmuri11-home.woff2`는 위와 동일한 원본·라이선스에서 생성한 별도 서브셋이다. `Minihompy Home`으로 사용하며 탭 파일과 설정은 변경하지 않았다. 본문에 탭의 scaleX(.92)를 적용하지 않는다. 작은 본문은 6px/9px, 구역 제목은 7px/9px, 페이지 제목은 8px/11px, 카운터와 통계 숫자는 Arial 계열이다. 모두 자간은 0이다.

Master와 HOME 캡처를 육안 비교해 고정 영역 내 문구 폭과 세 줄 배치를 확인했다. Galmuri는 당시 원본 폰트가 아니며, 특히 작은 크기의 획과 굵기는 작업 6에서 추가 비교해야 한다. 본문 원본 폰트를 확정했다는 의미가 아니다.

```sh
pyftsubset Galmuri11.woff2 --text-file=index.html --output-file=assets/fonts/Galmuri11-home.woff2 --flavor=woff2
```

작업 5 본문 서브셋 SHA-256: `1d06996a7293303c459284f6d3da19aa2881dce3a34b46b1b05878827fa8d49e`.

## 작업 6 보정

검색어·앱스·음악 기호 추가에 맞춰 같은 원본에서 본문 서브셋을 다시 생성했다. 현재 SHA-256: `77d6e4881c049ecd99a7deff1662b6de5a0b18ad9fcac635dea0c72cae5082cb`. 탭 파일과 해시는 그대로다.

크기 후보 비교 후 상단 메뉴·미니룸 보기·우측 보조 영역을 6.5px로, 게시판 통계 라벨도 6.5px로 조정했다. 안내문·프로필 상태·말풍선·일촌평 6px, 구역 제목 7px, 페이지 제목 8px는 유지했다. 페이지 제목은 크기 대신 y를 1px 내렸다. [후보 비교 기록](../../docs/verification/step6/type-study.json)과 [위치 비교 기록](../../docs/verification/step6/position-study.json)은 후보별 픽셀 차이 참고치이며 원본 폰트 식별 결과가 아니다. 이후 본문 문자가 추가되면 서브셋을 다시 생성해야 한다.

## Config 도입 이후

구조 작업 1번에서 `Galmuri11-extended.woff2`를 추가했다. 위에 기록한 동일한 Galmuri11 원본 전체 파일이며 SHA-256은 `8bad9322b3340bfb5cb26cb00f4752bf4c8e7d1b526bb07205f4af458eebed31`, 라이선스는 같은 OFL이다. 기존 HOME 서브셋을 우선 사용하고 없는 문자만 `Minihompy Extended`로 표시한다. 따라서 일반적인 새 한글 문구를 Config에 입력할 때마다 서브셋을 재생성할 필요가 없다. 원본 Galmuri에 없는 문자는 시스템 폰트로 대체될 수 있다.

DOM 속성 변경에 맞춰 다시 생성한 HOME 서브셋 SHA-256은 `17ba9aeb3294c16fa01480897e2573bca9c89b24e0a4e17ece693357275de60d`. 기본 화면 네 캡처는 작업 7과 픽셀 단위로 동일하다. 탭 파일과 폰트 설정은 변경하지 않았다.

## KBS 최근게시물 레퍼런스 보정 (2026-09-25)

최근게시물 목록과 집계 라벨에만 `Dotum, 돋움, Minihompy News, sans-serif`를 적용한다. `Minihompy News`는 기존 `Galmuri11-extended.woff2`를 재사용하는 대체 폰트다. Windows 돋움을 저장소에 포함하지 않는다. 제목과 숫자는 Arial 계열이다. KBS 화면의 332px 폭을 현재 홈의 240px에 비례시킨 크기를 사용하며, 시스템 돋움 유무에 따라 글리프 모양은 달라질 수 있다.
