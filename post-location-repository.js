(() => {
 'use strict';
 window.MinihompyPostLocation=Object.freeze({
  async locate(kind,id,size,client=window.MinihompyBackend.getClient('visitor')){
   if(!['board','photos','diary','guestbook'].includes(kind)||!window.MinihompyPostRoutes.validId(id)||!Number.isInteger(size)||size<1||size>20)throw Error('잘못된 글 주소입니다.');
   const result=['board','diary','photos'].includes(kind)?await window.MinihompyContentAccess?.read?.('location',{kind,id,size}):null;
   const {data,error}=result&&!result.legacy?{data:result.data}:await client.rpc('post_location',{p_kind:kind,p_id:id,p_size:size});
   if(error)throw Error('글 위치를 확인하지 못했습니다. 다시 시도해 주세요.');
   if(!data||data.id!==id||!Number.isSafeInteger(data.page)||data.page<1)throw Error('글이 삭제되었거나 조회할 수 없습니다.');
   if(kind!=='guestbook'&&!window.MinihompyPostRoutes.validId(data.folder_id))throw Error('글 위치를 확인하지 못했습니다.');
   if(kind==='diary'&&!/^\d{4}-\d{2}-\d{2}$/.test(data.entry_date||''))throw Error('글 날짜를 확인하지 못했습니다.');
   return data;
  },
 });
})();
