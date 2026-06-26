/* MEMONS collection storage (demo: browser localStorage)
   In production, replace with wallet/server ownership records. */
window.MEMONS_COLLECTION = {
  KEY: 'memonz_collection_v1',
  all(){ try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch(e){ return []; } },
  add(item){ const a=this.all(); a.unshift(Object.assign({ts:Date.now()},item));
    try{ localStorage.setItem(this.KEY, JSON.stringify(a)); }catch(e){} return a; },
  clear(){ try{ localStorage.removeItem(this.KEY); }catch(e){} },
  count(){ return this.all().length; },
  ownedNums(){ return new Set(this.all().map(x=>x.num)); },
  countChars(){ return this.ownedNums().size; },
};
