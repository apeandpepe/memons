MEMONS site (data + collection, unified build)
========================================
[Open] open-capsule.html  (double-click for the full simulation)

[Flow] Main -> OPEN CAPSULE -> pull (odds->animation->card) -> card auto-saved to your collection
       -> check owned cards in the COLLECTION menu -> OWNED mark + COLLECTED count reflected in the VAULT

[Pages]
  open-capsule.html   Main
  capsule-reveal.html Pull window (result auto-saved)
  collection.html     Your collection (owned-card grid / count / CLEAR)
  vault.html          Vault (OWNED mark, COLLECTED n/9999)
  detail.html         Detail (?id=number)

[Data managed in one place]
  data/memons.js     Characters/rarities (odds). Add a character with one line here.
  data/collection.js Collection storage (localStorage demo) -> replace with wallet/server in production

[Note] The collection is a demo stored in that browser. Real ownership will be wired to wallet/contract later.
