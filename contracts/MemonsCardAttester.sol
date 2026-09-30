// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 *  MEMONS - MemonsCardAttester
 *
 *  Records one opened card as one entry. The caller is the player's own
 *  account and the gas is paid by a paymaster. The earlier MemonsAttester
 *  anchored only a batch root, so the chain showed a single company wallet
 *  behind every card -- that is why this contract exists separately. Here
 *  msg.sender is the owner of the card.
 *
 *  Holds no funds and moves none. All it does is write, so there is nothing
 *  to take, and a spurious call leaves one extra record and nothing else.
 */
contract MemonsCardAttester {

    /* A card was recorded.

       Owner and card are both indexed. Indexers read "what this wallet did"
       and "what happened to this card" as separate questions; indexing only
       one of them means the other has to pull every log and filter. */
    event CardAttested(
        address indexed owner,
        bytes32 indexed cardKey,
        string  cardId,
        string  rarity,
        uint64  openedAt,
        uint256 seq
    );

    /* Guard against writing the same card twice.

       The key hashes owner together with card id. Keyed on the card id
       alone, the second player to pull a card of the same id would be
       turned away. */
    mapping(bytes32 => bool) public attested;

    /* How many cards each wallet has recorded. Used for reconciliation. */
    mapping(address => uint256) public countOf;

    /* Total entries. Also emitted as seq. */
    uint256 public total;

    error AlreadyAttested(bytes32 cardKey);
    error EmptyCardId();

    function keyOf(address owner, string calldata cardId)
        public pure returns (bytes32)
    {
        return keccak256(abi.encode(owner, cardId));
    }

    /**
     *  Record one card.
     *
     *  Whoever calls is written as the owner. There is no way to record
     *  under someone else's name, which is why owner is not an argument.
     */
    function attest(
        string calldata cardId,
        string calldata rarity,
        uint64 openedAt
    ) external returns (bytes32 cardKey) {
        if (bytes(cardId).length == 0) revert EmptyCardId();

        cardKey = keyOf(msg.sender, cardId);
        if (attested[cardKey]) revert AlreadyAttested(cardKey);

        attested[cardKey] = true;

        unchecked {
            countOf[msg.sender] += 1;
            total += 1;
        }

        emit CardAttested(msg.sender, cardKey, cardId, rarity, openedAt, total);
    }

    /**
     *  Several cards in one call.
     *
     *  A ten-pull goes up as a single entry. Weekly transacting users are
     *  counted by wallet, so splitting it into ten does not raise that
     *  figure -- it only multiplies the gas.
     *
     *  A card already on record is skipped rather than reverted. One
     *  duplicate should not cost the other nine.
     */
    function attestMany(
        string[] calldata cardIds,
        string[] calldata rarities,
        uint64[] calldata openedAts
    ) external returns (uint256 written) {
        uint256 n = cardIds.length;
        require(n == rarities.length && n == openedAts.length, "length mismatch");

        for (uint256 i = 0; i < n; ) {
            string calldata cardId = cardIds[i];

            if (bytes(cardId).length != 0) {
                bytes32 cardKey = keyOf(msg.sender, cardId);
                if (!attested[cardKey]) {
                    attested[cardKey] = true;
                    unchecked {
                        countOf[msg.sender] += 1;
                        total += 1;
                        written += 1;
                    }
                    emit CardAttested(
                        msg.sender, cardKey, cardId, rarities[i], openedAts[i], total
                    );
                }
            }

            unchecked { ++i; }
        }
    }
}
