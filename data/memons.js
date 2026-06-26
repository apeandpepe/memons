/* ============================================================
   MEMONS shared data  (read by the vault / detail / pull pages)
   * Edit it like JSON. Add a character with one line in characters.
   * Kept as .js instead of .json so it works locally (double-click).
   ============================================================ */
window.MEMONS_DATA = {

  /* rarity: pull odds (weight, sum to 100 recommended) + color + card image */
  rarities: [
    { key:'common',    label:'COMMON',    color:'#cfccc4', weight:60, card:'images/reveal/common.png',    memoria:'images/detail/memoria-common.png' },
    { key:'rare',      label:'RARE',      color:'#5b9bd5', weight:25, card:'images/reveal/rare.png',      memoria:'images/detail/memoria-rare.png' },
    { key:'epic',      label:'EPIC',      color:'#c468d8', weight:10, card:'images/reveal/epic.png',      memoria:'images/detail/memoria-epic.png' },
    { key:'legendary', label:'LEGENDARY', color:'#E9B84A', weight:4,  card:'images/reveal/legendary.png', memoria:'images/detail/memoria-legendary.png' },
    { key:'mythic',    label:'MYTHIC',    color:'#e0556a', weight:1,  card:'images/reveal/mythic.png',    memoria:'images/detail/memoria-mythic.png' },
  ],

  /* character: num/name/cat/img for vault cards. main/born/quote/desc for detail (omit if absent). */
  characters: [
    {
      num:'0001', name:'APEPE', cat:'CRYPTO MEME',
      img:'images/vault/apepe.png',
      main:'images/detail/apepe-main.png',
      born:'2023.06.07',
      quote:['Every meme starts as a joke.','Legends are created by communities.'],
      desc:[
        'Emerging from the heart of crypto culture, APEPE started as a simple image shared among degens on Polygon. But what began as a joke soon became a symbol of belief, resilience, and community.',
        'Through countless charts, crashes, and comebacks, APEPE represents the spirit of those who never sell, who hodl through the chaos, and who build the culture together.',
        "Not just a meme.\nIt's a movement."
      ]
    },
    { num:'0002', name:'DOGE',     cat:'INTERNET LEGEND', img:'images/vault/doge.png',     main:'images/detail/apepe-main.png' },
    { num:'0003', name:'NYAN CAT', cat:'VIRAL MEME',      img:'images/vault/nyancat.png',  main:'images/detail/apepe-main.png' },
    { num:'0004', name:'PEPE',     cat:'REACTION MEME',   img:'images/vault/pepe.png',     main:'images/detail/apepe-main.png' },
    { num:'0005', name:'CHILL GUY',cat:'RELATABLE MEME',  img:'images/vault/chillguy.png', main:'images/detail/apepe-main.png' },
    { num:'0006', name:'WOJAK',    cat:'CULTURE MEME',    img:'images/vault/wojak.png',    main:'images/detail/apepe-main.png' },

    /* unrevealed (locked) */
    { num:'0007', name:'???', cat:'UNKNOWN', locked:true },
    { num:'0008', name:'???', cat:'UNKNOWN', locked:true },
    { num:'0009', name:'???', cat:'UNKNOWN', locked:true },
    { num:'0010', name:'???', cat:'UNKNOWN', locked:true },
    { num:'0011', name:'???', cat:'UNKNOWN', locked:true },
    { num:'0012', name:'???', cat:'UNKNOWN', locked:true },
  ],

  total: 9999,  // for displaying the total collection size
};
