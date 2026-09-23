(() => {
  'use strict';
  // Only repository-owned markup belongs here; config values are bound as text.
  function fragment(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    return template.content;
  }
  window.MINIHOMPY_VIEWS.home = {
    label: '홈',
    showScrollbar: true,
    createLeft: () => fragment(`
      <div class="profile-image-slot reference-sprite" role="img" aria-label="손을 흔드는 줄무늬 셔츠의 프로필 캐릭터"></div>
      <p class="profile-status" data-config="profile.introduction">자기소개가 없습니다.</p>
      <div class="profile-history">
        <div class="history-heading"><span><i></i>HISTORY</span><span class="history-arrows">▾▴</span></div>
        <div class="profile-name"><span data-config="profile.name">정</span> <span class="profile-detail" data-config="profile.detail">(성)</span></div>
        <button type="button" class="surf-select" data-surf-open aria-haspopup="dialog" aria-controls="surf-dialog">파도타기<span aria-hidden="true">▴</span></button>
      </div>
    `),
    createMain: () => fragment(`
      <h2 class="recent-heading">최근게시물</h2>
      <div class="recent-content">
        <p class="recent-empty">등록된 게시물이 없습니다<br>소식이 뜸한 친구에게 마음의 한마디를<br>남겨주세요</p>
        <dl class="board-counts">
          <div><dt>다이어리</dt><dd>0/0</dd></div><div><dt>사진첩</dt><dd>0/0</dd></div>
          <div><dt>갤러리</dt><dd>0/0</dd></div><div><dt>게시판</dt><dd>0/0</dd></div>
          <div><dt>동영상</dt><dd>0/0</dd></div><div><dt>방명록</dt><dd>0/1</dd></div>
        </dl>
      </div>
      <div class="room-views"><span>미니라이프</span><strong>미니룸</strong><span>스토리룸</span></div>
      <div class="miniroom" aria-label="미니룸">
        <div class="room-balloon"><span data-config="home.roomMessage">미니룸 준비중</span></div>
        <div class="minime reference-sprite" role="img" aria-label="주황색 머리의 미니미"></div>
      </div>
      <h2 class="friends-heading">일촌평<span class="help-mark" aria-hidden="true">?</span></h2>
      <div class="friends-prompt"><span>일촌 기능 준비 중</span></div>
    `),
  };
})();
