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
    createMain() { const result=fragment(`
      <h2 class="recent-heading">최근게시물</h2>
      <div class="recent-content home-activity"></div>
      <div class="room-views"><span>미니라이프</span><strong>미니룸</strong><span>스토리룸</span></div>
      <div class="miniroom" aria-label="미니룸">
        <div class="room-balloon"><span data-config="home.roomMessage">미니룸 준비중</span></div>
        <div class="minime reference-sprite" role="img" aria-label="주황색 머리의 미니미"></div>
      </div>
      <h2 class="friends-heading">일촌평<span class="help-mark" aria-hidden="true">?</span></h2>
      <div class="friends-prompt"><span>일촌 기능 준비 중</span></div>
    `);
      window.MinihompyHomeActivity?.attach(result.querySelector('.home-activity'));
      return result;
    },
  };
})();
