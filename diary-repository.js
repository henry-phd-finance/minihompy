(() => {
  'use strict';
  const reader = async () => (await window.MinihompyContentAccess.open()).client;
  const checked = result => { if (result.error) throw result.error; return result; };
  const writer = async () => (await window.MinihompyContentAccess.open(true)).client;
  function validate(draft) {
    const date = draft.entry_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01' || date > '9999-12-31'
      || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('올바른 날짜를 선택해 주세요.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.entry_time)) throw new Error('올바른 시간을 선택해 주세요.');
    if (!draft.folder_id || !['', '맑음', '흐림', '비', '눈'].includes(draft.weather)) throw new Error('폴더와 날씨를 확인해 주세요.');
    if (!draft.body.trim() || [...draft.body].length > 50000) throw new Error('본문을 1~50,000자 이내로 작성해 주세요.');
  }
  window.MinihompyDiaryRepository = Object.freeze({
    context: () => window.MinihompyContentAccess.open(),
    validate,
    async folders() { return checked(await (await reader()).from('diary_folders').select('*').order('sort_order').order('id')).data; },
    async dates(folder, month, ctx) { return checked(await (ctx?.client || await reader()).rpc('diary_written_dates', { selected_folder: folder, month_start: `${month}-01` })).data; },
    async list(folder, date, page, size, ctx) {
      const result = checked(await (ctx?.client || await reader()).from('diary_entries').select('*', { count: 'exact' }).eq('folder_id', folder).eq('entry_date', date)
        .order('entry_time').order('id').range((page - 1) * size, page * size - 1));
      return { items: result.data, count: result.count };
    },
    async save(draft) {
      validate(draft);
      const client = await writer();
      const fields = { folder_id: draft.folder_id, entry_date: draft.entry_date, entry_time: draft.entry_time, weather: draft.weather, body: draft.body, visibility: draft.visibility || 'public' };
      if (!['public','private'].includes(fields.visibility)) throw Error('공개범위를 확인해 주세요.');
      const existing = async () => checked(await client.from('diary_entries').select('*').eq('id', draft.id).maybeSingle()).data;
      const same = row => row && Object.entries(fields).every(([key, value]) => (key === 'entry_time' ? row[key].slice(0, 5) : row[key]) === value);
      if (!draft.revision) {
        const prior = await existing();
        if (prior) { if (same(prior)) return prior; throw new Error('이미 저장된 일기입니다. 다시 조회해 주세요.'); }
      }
      const query = draft.revision
        ? client.from('diary_entries').update(fields).eq('id', draft.id).eq('revision', draft.revision)
        : client.from('diary_entries').insert({ ...fields, id: draft.id, author_name: window.MINIHOMPY_CONFIG.profile.name.trim() });
      const row = checked(await query.select('*').maybeSingle()).data;
      if (row) return row;
      const prior = await existing();
      if (same(prior)) return prior;
      throw new Error('다른 곳에서 변경된 일기이거나 수정 권한이 없습니다.');
    },
    async remove(entry) {
      const client = await writer();
      const row = checked(await client.from('diary_entries').delete().eq('id', entry.id).eq('revision', entry.revision).select('id').maybeSingle()).data;
      if (!row) throw new Error('일기가 변경되었거나 삭제 권한이 없습니다. 다시 조회해 주세요.');
    },
  });
})();
