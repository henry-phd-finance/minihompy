(() => {
  'use strict';
  const kinds=['board','photos','diary','guestbook'];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function parse(hash) {
    try {
      if(!hash.startsWith('#/'))return {id:null,post:null};
      const [path,query,...extra]=hash.slice(2).split('?'),id=decodeURIComponent(path),params=new URLSearchParams(query||'');
      if(extra.length||!id||[...params.keys()].some(k=>k!=='post')||params.getAll('post').length>1)throw Error();
      if(params.has('post')&&(!kinds.includes(id)||!uuid.test(params.get('post'))))throw Error();
      return {id,post:params.get('post')?.toLowerCase()||null};
    }catch{return {id:null,post:null,invalid:true,hash};}
  }
  function href(id,post=null) {
    if(typeof id!=='string'||!id||post&&(!kinds.includes(id)||!uuid.test(post)))throw new TypeError('잘못된 글 주소입니다.');
    return '#/'+encodeURIComponent(id)+(post?'?post='+post.toLowerCase():'');
  }
  function focus(root,id) {
    if(!id||!root?.isConnected)return;
    const element=[...root.querySelectorAll('[data-post],[data-entry]')].find(e=>(e.dataset.post||e.dataset.entry)===id);
    if(element){element.tabIndex=-1;element.focus({preventScroll:true});element.scrollIntoView({block:'nearest'});}
  }
  function guard(read) {
    window.addEventListener('minihompy:before-navigate',event=>{const state=read(event.detail.destination);if(state&&(state.busy||state.dirty))event.detail.push(state);});
  }
  window.MinihompyPostRoutes=Object.freeze({parse,href,focus,guard,validId:id=>uuid.test(id||'')});
})();
