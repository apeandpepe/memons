# MEMONS — Contract Reference

Last updated: 2026-09-29

- Project: **MEMONS**
- Site: https://memons.io
- Parent project: **APEPE**

---

## Card attestations on Base

Every capsule a player opens is written to Base as one entry. The call is
made by the player's own account and the gas is paid by a paymaster, so
`msg.sender` on every record is the card's owner — not a company wallet.

| Item | Value |
| --- | --- |
| Chain | Base mainnet |
| Contract | [`0x3f80799955F937adcbd695Ad8fF6b1Ea1b167353`](https://basescan.org/address/0x3f80799955F937adcbd695Ad8fF6b1Ea1b167353) |
| Name | `MemonsCardAttester` |
| Compiler | Solidity 0.8.34 |
| Source verified | Yes — on Basescan and Blockscout |
| Source in this repo | [`contracts/MemonsCardAttester.sol`](contracts/MemonsCardAttester.sol) |

The contract holds no funds and moves none. It only writes records.

### Event

```solidity
event CardAttested(
    address indexed owner,
    bytes32 indexed cardKey,
    string  cardId,
    string  rarity,
    uint64  openedAt,
    uint256 seq
);
```

### Reproducing our user numbers

`owner` is the card holder, so the number of distinct `owner` values is
the number of users. Anyone can run this and get the same figure:

```sql
select count(distinct topics[2]) as weekly_users,
       count(*)                  as cards
from base.events
where address = '0x3f80799955f937adcbd695ad8ff6b1ea1b167353'
  and block_timestamp >= toDateTime('2026-09-13 00:00:00')
  and block_timestamp <  toDateTime('2026-09-20 00:00:00');
```

### Earlier contract

An earlier version, `MemonsAttester`, anchored only a batch root, which
made every card look like it came from one company wallet. It was
replaced by the contract above for that reason.

| Item | Value |
| --- | --- |
| Contract | `TBD` |
| Status | Superseded, no longer written to |

---

## Accepted payment tokens

Third-party standard token contracts. Listed for completeness; MEMONS
does not control them.

| Chain | Token | Address |
| --- | --- | --- |
| Polygon | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| BSC | USDT | `0x55d398326f99059fF775485246999027B3197955` |

Payment receiving addresses are not listed. They are being replaced by
per-user deposit addresses, and this document will be updated once that
change ships.

---

## Contact

- admin@apepe.lol
- https://t.me/APEPE_Official
- https://x.com/apepeofficial
