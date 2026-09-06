const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");

// =====================================================
// FIREBASE
// =====================================================

admin.initializeApp();

const db = admin.database();

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// SETTINGS
// =====================================================

const ROUND_TOTAL_MS = 23400;
const BETTING_MS = 17000;

const SUITS = ["♠", "♥", "♦", "♣"];

const RANKS = [
    { name: "2", value: 2 },
    { name: "3", value: 3 },
    { name: "4", value: 4 },
    { name: "5", value: 5 },
    { name: "6", value: 6 },
    { name: "7", value: 7 },
    { name: "8", value: 8 },
    { name: "9", value: 9 },
    { name: "10", value: 10 },
    { name: "J", value: 11 },
    { name: "Q", value: 12 },
    { name: "K", value: 13 },
    { name: "A", value: 14 }
];

// =====================================================
// SECURE RANDOM
// =====================================================

function secureRandom(max) {
    return crypto.randomInt(0, max);
}

// =====================================================
// CREATE DECK
// =====================================================

function createDeck() {

    const deck = [];

    for (const suit of SUITS) {

        for (const rank of RANKS) {

            deck.push({
                rank: rank.name,
                value: rank.value,
                suit: suit
            });

        }
    }

    return deck;
}

// =====================================================
// SHUFFLE
// =====================================================

function shuffleDeck(deck) {

    const result = [...deck];

    for (let i = result.length - 1; i > 0; i--) {

        const j = secureRandom(i + 1);

        const temp = result[i];

        result[i] = result[j];
        result[j] = temp;
    }

    return result;
}

// =====================================================
// HAND EVALUATION
// =====================================================

function evaluateHand(cards) {

    const values = cards
        .map(card => card.value)
        .sort((a, b) => b - a);

    const suits = cards.map(card => card.suit);

    const sameSuit =
        suits[0] === suits[1] &&
        suits[1] === suits[2];

    const counts = {};

    for (const value of values) {

        counts[value] =
            (counts[value] || 0) + 1;
    }

    const countValues =
        Object.values(counts);

    // -----------------------------
    // TRAIL
    // -----------------------------

    if (countValues.includes(3)) {

        return {
            name: "Trail",
            rank: 6,
            tie: [values[0]]
        };
    }

    // -----------------------------
    // STRAIGHT
    // -----------------------------

    let straight = false;

    let straightHigh = values[0];

    // A-2-3
    if (
        values[0] === 14 &&
        values[1] === 3 &&
        values[2] === 2
    ) {

        straight = true;
        straightHigh = 3;

    } else {

        straight =
            values[0] === values[1] + 1 &&
            values[1] === values[2] + 1;
    }

    // -----------------------------
    // STRAIGHT FLUSH
    // -----------------------------

    if (straight && sameSuit) {

        return {
            name: "Straight Flush",
            rank: 5,
            tie: [straightHigh]
        };
    }

    // -----------------------------
    // FLUSH
    // -----------------------------

    if (sameSuit) {

        return {
            name: "Flush",
            rank: 4,
            tie: values
        };
    }

    // -----------------------------
    // STRAIGHT
    // -----------------------------

    if (straight) {

        return {
            name: "Straight",
            rank: 3,
            tie: [straightHigh]
        };
    }

    // -----------------------------
    // PAIR
    // -----------------------------

    if (countValues.includes(2)) {

        let pairValue = 0;
        let kicker = 0;

        for (const value of values) {

            if (counts[value] === 2) {

                pairValue =
                    Math.max(pairValue, value);

            } else {

                kicker =
                    Math.max(kicker, value);
            }
        }

        return {
            name: "Pair",
            rank: 2,
            tie: [pairValue, kicker]
        };
    }

    // -----------------------------
    // HIGH CARD
    // -----------------------------

    return {
        name: "High Card",
        rank: 1,
        tie: values
    };
}

// =====================================================
// COMPARE HANDS
// =====================================================

function compareHands(a, b) {

    if (a.rank !== b.rank) {

        return a.rank > b.rank ? 1 : -1;
    }

    const length =
        Math.max(
            a.tie.length,
            b.tie.length
        );

    for (let i = 0; i < length; i++) {

        const av = a.tie[i] || 0;
        const bv = b.tie[i] || 0;

        if (av !== bv) {

            return av > bv ? 1 : -1;
        }
    }

    return 0;
}

// =====================================================
// CREATE ROUND RESULT
// =====================================================

function createRoundResult() {

    const deck =
        shuffleDeck(createDeck());

    // 9 UNIQUE CARDS
    const cardsA = deck.slice(0, 3);
    const cardsB = deck.slice(3, 6);
    const cardsC = deck.slice(6, 9);

    const handA =
        evaluateHand(cardsA);

    const handB =
        evaluateHand(cardsB);

    const handC =
        evaluateHand(cardsC);

    const hands = [
        {
            seat: 1,
            hand: handA
        },
        {
            seat: 2,
            hand: handB
        },
        {
            seat: 3,
            hand: handC
        }
    ];

    let winner = hands[0];

    for (let i = 1; i < hands.length; i++) {

        const result =
            compareHands(
                hands[i].hand,
                winner.hand
            );

        if (result > 0) {

            winner = hands[i];
        }
    }

    return {

        cards: {

            A: cardsA,
            B: cardsB,
            C: cardsC
        },

        hands: {

            A: handA.name,
            B: handB.name,
            C: handC.name
        },

        winner: winner.seat,

        generatedAt: Date.now()
    };
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {

    res.status(200).send(
        "VibeCash Teen Patti Server OK"
    );
});

// =====================================================
// PLACE BET
// =====================================================

app.post("/placeTeenPattiBet", async (req, res) => {

    try {

        const {
            uid,
            side,
            amount,
            roundId
        } = req.body;

        if (
            !uid ||
            side === undefined ||
            amount === undefined ||
            !roundId
        ) {

            return res.status(400).json({

                success: false,

                error: "Invalid bet data"
            });
        }

        const sideNumber =
            Number(side);

        const amountNumber =
            Number(amount);

        if (
            !Number.isFinite(sideNumber) ||
            !Number.isFinite(amountNumber) ||
            amountNumber <= 0 ||
            sideNumber < 1 ||
            sideNumber > 3
        ) {

            return res.status(400).json({

                success: false,

                error: "Invalid side or amount"
            });
        }

        /*
         * IMPORTANT:
         *
         * Tumhara existing Firebase bet/demand logic
         * agar Android direct Firebase me kar raha hai,
         * to yahan sirf API acknowledgement rahega.
         */

        return res.status(200).json({

            success: true,

            message: "Bet placed successfully",

            side: sideNumber,

            amount: amountNumber,

            roundId: String(roundId)
        });

    } catch (error) {

        console.error(
            "placeTeenPattiBet:",
            error
        );

        return res.status(500).json({

            success: false,

            error: error.message
        });
    }
});

// =====================================================
// GET TEEN PATTI ROUND
// =====================================================

app.post("/getTeenPattiRound", async (req, res) => {

    try {

        const {
            roundId
        } = req.body;

        if (!roundId) {

            return res.status(400).json({

                success: false,

                error: "roundId required"
            });
        }

        const id =
            String(roundId);

        const roundNumber =
            Number(roundId);

        if (
            !Number.isFinite(roundNumber) ||
            roundNumber <= 0
        ) {

            return res.status(400).json({

                success: false,

                error: "Invalid roundId"
            });
        }

        const roundRef =
            db
                .ref("global_teen_patti")
                .child("rounds")
                .child(id);

        // =================================================
        // IMPORTANT FIX
        //
        // Android ka roundId:
        //
        // floor(currentTime / 23400)
        //
        // Isliye round start:
        //
        // roundId * 23400
        // =================================================

        const startTime =
            roundNumber * ROUND_TOTAL_MS;

        const now =
            Date.now();

        const elapsed =
            now - startTime;

        // =================================================
        // CHECK EXISTING RESULT
        // =================================================

        const existingSnapshot =
            await roundRef.once("value");

        const existing =
            existingSnapshot.val();

        if (
            existing &&
            existing.cards &&
            existing.cards.A &&
            existing.cards.B &&
            existing.cards.C &&
            existing.winner
        ) {

            return res.status(200).json({

                success: true,

                roundId: id,

                bettingOpen: false,

                cards: existing.cards,

                hands: existing.hands || {},

                winner:
                    Number(existing.winner),

                generatedAt:
                    existing.generatedAt || 0
            });
        }

        // =================================================
        // BETTING OPEN
        // =================================================

        if (elapsed < BETTING_MS) {

            return res.status(200).json({

                success: true,

                roundId: id,

                bettingOpen: true,

                remainingMs:
                    BETTING_MS - elapsed,

                cards: null,

                hands: null,

                winner: 0
            });
        }

        // =================================================
        // BETTING CLOSED
        // CREATE RESULT
        // =================================================

        const generated =
            createRoundResult();

        // =================================================
        // SAVE RESULT ONLY ONCE
        // =================================================

        await roundRef.transaction(
            current => {

                // Already generated
                if (
                    current &&
                    current.cards &&
                    current.cards.A &&
                    current.cards.B &&
                    current.cards.C &&
                    current.winner
                ) {

                    return;
                }

                return {

                    startTime: startTime,

                    cards: generated.cards,

                    hands: generated.hands,

                    winner: generated.winner,

                    generatedAt:
                        generated.generatedAt
                };
            }
        );

        // =================================================
        // READ FINAL RESULT
        // =================================================

        const finalSnapshot =
            await roundRef.once("value");

        const finalRound =
            finalSnapshot.val();

        if (
            !finalRound ||
            !finalRound.cards ||
            !finalRound.cards.A ||
            !finalRound.cards.B ||
            !finalRound.cards.C
        ) {

            return res.status(500).json({

                success: false,

                error:
                    "Round result could not be created"
            });
        }

        // =================================================
        // RETURN 9 CARDS
        // =================================================

        return res.status(200).json({

            success: true,

            roundId: id,

            bettingOpen: false,

            cards: {

                A: finalRound.cards.A,

                B: finalRound.cards.B,

                C: finalRound.cards.C
            },

            hands:
                finalRound.hands || {},

            winner:
                Number(finalRound.winner),

            generatedAt:
                finalRound.generatedAt || 0
        });

    } catch (error) {

        console.error(
            "getTeenPattiRound:",
            error
        );

        return res.status(500).json({

            success: false,

            error: error.message
        });
    }
});

// =====================================================
// SETTLE ROUND
// =====================================================

app.post("/settleTeenPattiRound", async (req, res) => {

    try {

        const {
            roundId
        } = req.body;

        if (!roundId) {

            return res.status(400).json({

                success: false,

                error: "roundId required"
            });
        }

        return res.status(200).json({

            success: true,

            message: "Settled",

            roundId:
                String(roundId)
        });

    } catch (error) {

        console.error(
            "settleTeenPattiRound:",
            error
        );

        return res.status(500).json({

            success: false,

            error: error.message
        });
    }
});

// =====================================================
// START SERVER
// =====================================================

const PORT =
    process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `Teen Patti server running on port ${PORT}`
    );

});
