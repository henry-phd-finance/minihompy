(() => {
  'use strict';
  const kinds = ['board','photos','diary','guestbook'];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const count = n => Number.isSafeInteger(n) && n >= 0;
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
  function validate(data, requested) {
    const bad = () => { throw new Error('홈 요약 응답이 올바르지 않습니다.'); };
    if (!keys(data,['version','as_of','date','timezone','menus','recent','counts','today_comments']) || data.version !== 1 || data.timezone !== 'Asia/Seoul' || !Number.isFinite(Date.parse(data.as_of)) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) bad();
    const koreanDate = new Date(Date.parse(data.as_of)+9*3600000).toISOString().slice(0,10);
    if (koreanDate !== data.date || !Array.isArray(data.menus) || data.menus.length>4 || new Set(data.menus).size!==data.menus.length || data.menus.some(m=>!requested.includes(m))) bad();
    if (!keys(data.counts,data.menus) || !count(data.today_comments) || !Array.isArray(data.recent) || data.recent.length>5) bad();
    for (const m of data.menus) { const c=data.counts[m]; if(!keys(c,['today','total']) || !count(c.today) || !count(c.total) || c.today>c.total) bad(); }
    const seen = new Set();
    for (const item of data.recent) {
      if (!keys(item,['kind','id','created_at','label','today_comments']) || !data.menus.includes(item.kind) || !uuid.test(item.id) || typeof item.label!=='string' || [...item.label].length>120 || !count(item.today_comments) || item.today_comments>data.today_comments || !Number.isFinite(Date.parse(item.created_at)) || Date.parse(item.created_at)>Date.parse(data.as_of)) bad();
      const key=item.kind+':'+item.id; if(seen.has(key))bad(); seen.add(key);
    }
    if (data.recent.length!==Math.min(5,data.menus.reduce((n,m)=>n+data.counts[m].total,0))) bad();
    return data;
  }
  window.MinihompyHomeRepository = Object.freeze({
    async summary(menus = kinds, {signal} = {}) {
      if (!Array.isArray(menus) || menus.length>4 || new Set(menus).size!==menus.length || menus.some(m=>!kinds.includes(m))) throw new TypeError('잘못된 홈 메뉴입니다.');
      // No member-writing grant, admin client, auth refresh or cache is required.
      let query = window.MinihompyBackend.getClient('visitor').rpc('home_summary',{p_menus:[...menus]});
      if(signal)query=query.abortSignal(signal);
      const {data,error}=await query;
      if(error)throw new Error('홈 소식을 불러오지 못했습니다. 다시 시도해 주세요.');
      return validate(data,menus);
    },
  });
})();
