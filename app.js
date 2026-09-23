(() => {
  'use strict';
  const leftSlot = document.querySelector('[data-view-slot="left"]');
  const mainSlot = document.querySelector('[data-view-slot="main"]');
  const scrollbar = document.querySelector('.home-scrollbar');
  const tabs = document.querySelector('.page-tabs');
  let currentView = null, menus = [], visibleIds = new Set(), authResolved = false;
  const admin = () => window.MinihompyAdmin?.state.role === 'admin';
  function locationId() {
    try { return location.hash.startsWith('#/') ? decodeURIComponent(location.hash.slice(2)) : null; } catch { return null; }
  }
  function markSelection() {
    for (const link of tabs.children) {
      const active = link.dataset.menu === currentView;
      link.classList.toggle('selected', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  function rebuildMenus() {
    const seen = new Set(); menus = [];
    if (window.MinihompySettings.status === 'ready') {
      for (const item of window.MINIHOMPY_CONFIG.menus) {
        if (!item || item.id === 'settings' || seen.has(item.id) || !window.MINIHOMPY_VIEWS[item.id]) continue;
        seen.add(item.id);
        if (item.visible === true) menus.push({ id: item.id, label: item.label });
      }
    }
    // System-owned tab: never sourced from editable menu settings.
    if (admin()) menus.push({ id: 'settings', label: '설정' });
    visibleIds = new Set(menus.map(item => item.id));
    tabs.replaceChildren(...menus.map(item => {
      const link = document.createElement('a'); link.className = 'page-tab';
      link.href = `#/${encodeURIComponent(item.id)}`; link.dataset.menu = item.id; link.title = item.label;
      const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = item.label;
      link.append(label); return link;
    }));
    markSelection();
    window.MinihompyContent.fit();
  }
  function unavailable() {
    currentView = null;
    leftSlot.replaceChildren(); mainSlot.replaceChildren();
    leftSlot.dataset.view = mainSlot.dataset.view = '';
    scrollbar.hidden = true;
    const text = document.createElement('p'); text.className = 'settings-load-message'; text.setAttribute('role', 'status');
    text.textContent = window.MinihompySettings.status === 'loading' ? '설정을 불러오는 중입니다.' : window.MinihompySettings.status === 'error' ? window.MinihompySettings.error : '표시할 메뉴가 없습니다.';
    mainSlot.append(text);
    if (window.MinihompySettings.status === 'error') {
      const retry = document.createElement('button'); retry.className = 'settings-load-retry'; retry.type = 'button'; retry.textContent = '다시 불러오기';
      retry.addEventListener('click', () => { void window.MinihompySettings.load(); }); mainSlot.append(retry);
    }
    markSelection();
  }
  function showView(id) {
    if (id === 'settings' && !admin()) return;
    const view = window.MINIHOMPY_VIEWS[id];
    const left = view.createLeft(), main = view.createMain();
    if (!(left instanceof DocumentFragment) || !(main instanceof DocumentFragment)) throw new TypeError(`View ${id} must create two DocumentFragments.`);
    window.MinihompyContent.apply(left); window.MinihompyContent.apply(main);
    leftSlot.replaceChildren(left); mainSlot.replaceChildren(main);
    leftSlot.dataset.view = mainSlot.dataset.view = id;
    leftSlot.setAttribute('aria-label', `${view.label} 왼쪽 영역`); mainSlot.setAttribute('aria-label', view.label);
    leftSlot.scrollTop = mainSlot.scrollTop = 0; scrollbar.hidden = !view.showScrollbar;
    currentView = id; markSelection(); window.MinihompyContent.fit();
  }
  function renderView(requestedId, replace = false, force = false) {
    if (window.MINIHOMPY_IDENTITY_RETURN_PENDING) return false;
    // An early Auth result must not replace a pending deep link with settings.
    if (window.MinihompySettings.status === 'loading' && requestedId !== 'settings') { unavailable(); return false; }
    if (requestedId === 'settings' && !authResolved && !admin()) { unavailable(); return false; }
    const fallback = menus.find(item => item.id === 'home')?.id || menus[0]?.id;
    const id = visibleIds.has(requestedId) ? requestedId : fallback;
    if (!id) { unavailable(); return false; }
    if (id !== currentView || force) showView(id);
    const hash = `#/${encodeURIComponent(id)}`;
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    return id === requestedId;
  }
  function updateSettings() {
    document.documentElement.dataset.settingsStatus = window.MinihompySettings.status;
    window.MinihompyContent.apply(); rebuildMenus();
    // Keep the settings form/draft intact while its own save publishes new values.
    renderView(currentView || locationId(), true, currentView !== 'settings');
  }
  tabs.addEventListener('click', event => {
    const link = event.target.closest('a[data-menu]');
    if (!link || !tabs.contains(link) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); renderView(link.dataset.menu);
  });
  window.addEventListener('hashchange', () => renderView(locationId(), true));
  window.addEventListener('minihompy:settings', updateSettings);
  window.addEventListener('minihompy:identity', () => {
    authResolved = true; rebuildMenus(); renderView(currentView || locationId(), true);
  });
  window.MinihompyApp = { renderView, get currentView() { return currentView; } };
  window.MinihompyContent.apply(); unavailable();
  void window.MinihompySettings.load();
})();
