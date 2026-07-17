/* ============================================================
   MEMONS reward / collection game-layer config
   * K = total distinct kinds in that grade (dex denominator)
   * N = kinds needed per reward
   * reward:  { type:'card', grade:'rare' }  -> one card of that grade
   *          { type:'coin', amount:500000000 } -> APEPE coins
   *
   * OWNERSHIP SOURCE
   *  - Wallet connected: real ownership from backend via
   *    MEMONS.state() -> { owned:[ {card_id, rarity, ...} ] }
   *    (call MEMONS_REWARDS.loadServerOwned(state.owned)).
   *  - Otherwise: local demo collection (MEMONS_COLLECTION) fallback.
   ============================================================ */
window.MEMONS_REWARDS = {
  grades: {
    common:    { K:40, N:20, reward:{ type:'card', grade:'rare'  } },
    rare:      { K:25, N:15, reward:{ type:'card', grade:'epic'  } },
    epic:      { K:15, N:7,  reward:{ type:'coin', amount:500000000  } },
    legendary: { K:10, N:5,  reward:{ type:'coin', amount:1000000000 } },
    mythic:    { K:10, N:3,  reward:{ type:'coin', amount:3000000000 } },
  },
  coinSymbol: 'APEPE',
  coinImage : 'images/vault/apepe.png',

  _live: null,   // reward-eligible cards (used ones excluded)
  _all: null,    // every distinct card collected (dex progress)
  _imgs: null,
  _used: null,      // Set of card_ids already consumed by a reward
  _usedImgs: null,  // consumed cards per grade (for the 'REWARD CLAIMED' stamp)

  _keyOf: function(v){
    if(v==null) return null;
    var s=String(v).toLowerCase();
    if(this.grades[s]) return s;
    try{
      var hit=(window.MEMONS_DATA?MEMONS_DATA.rarities:[]).find(function(r){
        return r.key.toLowerCase()===s || r.label.toLowerCase()===s;
      });
      return hit?hit.key:null;
    }catch(e){ return null; }
  },

  // Cards already spent on a reward. They stay in the wallet (and can be sold),
  // but they can never fund another reward — so they don't count here either.
  setUsedCards: function(ids){
    this._used = new Set((ids||[]).map(String));
    return this;
  },
  isUsed: function(cardId){
    return !!(this._used && this._used.has(String(cardId)));
  },

  loadServerOwned: function(owned){
    var live={}, all={}, imgs={}, usedImgs={}, self=this, skipped=0;
    (owned||[]).forEach(function(x){
      if(!x) return;
      // rarity/grade may arrive under several names, and may be nested under .cards or .card
      var nested = x.cards || x.card || {};
      var rk=self._keyOf(x.rkey || x.rarity || x.grade || nested.rarity || nested.grade);
      var id=(x.num!=null?x.num:
             (x.card_id!=null?x.card_id:
             (x.id!=null?x.id:
             (nested.card_id!=null?nested.card_id:
             (nested.id!=null?nested.id:null)))));
      if(!rk || id==null){ skipped++; return; }
      var url0 = x.image_url || x.img || nested.image_url || nested.img;

      // dex progress counts EVERY distinct card the wallet has ever collected,
      // including ones already spent on a reward — collecting it happened.
      (all[rk]=all[rk]||new Set()).add(String(id));

      if(self.isUsed(id)){
        // spent on a reward: still shown (stamped) and still counts for the dex,
        // but it can never fund another reward
        var ug=(usedImgs[rk]=usedImgs[rk]||{});
        if(!(id in ug)) ug[id] = url0 || '';
        return;
      }
      var set=(live[rk]=live[rk]||new Set());
      if(!set.has(String(id))){
        set.add(String(id));
        // keep the real artwork of each distinct card the user owns
        var url = x.image_url || x.img || nested.image_url || nested.img;
        if(url){ (imgs[rk]=imgs[rk]||[]).push(url); }
      }
    });
    // If the server returned nothing usable, keep the local fallback instead of
    // wiping the view to zero.
    if(skipped && window.console) console.warn('[MEMONS_REWARDS] owned items skipped (unrecognised shape):', skipped, 'sample:', (owned||[])[0]);
    var any = Object.keys(live).some(function(k){ return live[k] && live[k].size>0; });
    this._usedImgs = usedImgs;
    this._all = all;
    if(!any && !Object.keys(all).length){ this._live=null; this._imgs=null; this._all=null; return this; }
    this._live=live; this._imgs=imgs;
    return this;
  },

  /* cards in this grade that were spent on a reward (shown with a stamp) */
  usedImages: function(rkey, limit){
    var m = this._usedImgs && this._usedImgs[rkey];
    var out = m ? Object.keys(m).map(function(k){ return m[k]; }) : [];
    return limit ? out.slice(0,limit) : out;
  },
  usedKinds: function(rkey){
    var m = this._usedImgs && this._usedImgs[rkey];
    return m ? Object.keys(m).length : 0;
  },

  /* real artwork of the distinct cards owned in a grade (for filmstrips) */
  ownedImages: function(rkey, limit){
    var out=[];
    if(this._imgs && this._imgs[rkey]) out=this._imgs[rkey].slice();
    else{
      // local fallback: distinct cards from MEMONS_COLLECTION
      try{
        var seen={};
        (window.MEMONS_COLLECTION ? MEMONS_COLLECTION.all() : []).forEach(function(x){
          if(x.rkey===rkey && !seen[x.num]){ seen[x.num]=1; if(x.img) out.push(x.img); }
        });
      }catch(e){}
    }
    return limit ? out.slice(0,limit) : out;
  },
  clearServerOwned: function(){ this._live=null; this._imgs=null; return this; },
  isLive: function(){ return this._live!==null; },

  /* dex progress: every distinct card collected, used ones included */
  ownedKinds: function(rkey){
    if(this._all){ return this._all[rkey] ? this._all[rkey].size : 0; }
    if(this._live){ return this._live[rkey] ? this._live[rkey].size : 0; }
    try{
      var set=new Set();
      (window.MEMONS_COLLECTION ? MEMONS_COLLECTION.all() : []).forEach(function(x){
        if(x.rkey===rkey) set.add(x.num);
      });
      return set.size;
    }catch(e){ return 0; }
  },

  /* reward eligibility: cards already spent on a reward don't count */
  eligibleKinds: function(rkey){
    if(this._live){ return this._live[rkey] ? this._live[rkey].size : 0; }
    return this.ownedKinds(rkey) - this.usedKinds(rkey);
  },

  status: function(rkey, claimed){
    var g=this.grades[rkey]; if(!g) return {owned:0,eligible:0,earned:0,claimable:0,max:0};
    var owned=this.ownedKinds(rkey);          // dex
    var eligible=this.eligibleKinds(rkey);    // rewards
    var earned=Math.floor(eligible/g.N), max=Math.floor(g.K/g.N);
    return { owned:owned, eligible:eligible, earned:earned, claimable:Math.max(0, earned-(claimed||0)), max:max };
  }
};
