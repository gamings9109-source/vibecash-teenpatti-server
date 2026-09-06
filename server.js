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

app.use(express.json());
app.use(cors());

// =====================================================
// TEEN PATTI SETTINGS
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
// SECURE RANDOM NUMBER
// =====================================================

function secureRandom(max) {
    return crypto.randomInt(0, max);
}

// =====================================================
// CREATE FULL DECK
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
// CARD TEXT
// =====================================================

function cardText(card) {
    return `${card.rank}${card.suit}`;
}

// =====================================================
// HAND EVALUATION
//
// Score:
// Trail         6
// Straight Flush 5
// Flush         4
// Straight      3
// Pair          2
// High Card     1
// =====================================================

function evaluateHand(cards) {

    const values = cards
        .map(c => c.value)
        .sort((a, b) => b - a);

    const suits = cards.map(c => c.suit);

    const sameSuit =
        suits[0] === suits[1] &&
        suits[1] === suits[2];

    const counts = {};

    for (const value of values) {

        counts[value] = (counts[value] || 0) + 1;
    }

    const countValues = Object.values(counts);

    const isTrail =
        countValues.includes(3);

    // A-2-3 special straight
    let straight = false;

    if (
        values[0] === 14 &&
        values[1] === 3 &&
        values[2] === 2
    ) {

        straight = true;

    } else {

        straight =
            values[0] === values[1] + 1 &&
            values[1] === values[2] + 1;
    }

    if (isTrail) {

        return {
            name: "Trail",
            rank: 6,
            tie: [values[0]]
        };
    }

    if (straight && sameSuit) {

        return {
            name: "Straight Flush",
            rank: 5,
            tie: values
        };
    }

    if (sameSuit) {

        return {
            name: "Flush",
            rank: 4,
            tie: values
        };
    }

    if (straight) {

        return {
            name: "Straight",
            rank: 3,
            tie: values
        };
    }

    if (countValues.includes(2)) {

        let pairValue = 0;
        let kicker = 0;

        for (const value of values) {

            if (counts[value] === 2) {

                pairValue = Math.max(pairValue, value);

            } else {

                kicker = Math.max(kicker, value);
            }
        }

        return {
            name: "Pair",
            rank: 2,
            tie: [pairValue, kicker]
        };
    }

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
        Math.max(a.tie.length, b.tie.length);

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

    const deck = shuffleDeck(createDeck());

    const cardsA = deck.slice(0, 3);
    const cardsB = deck.slice(3, 6);
    const cardsC = deck.slice(6, 9);

    const handA = evaluateHand(cardsA);
    const handB = evaluateHand(cardsB);
    const handC = evaluateHand(cardsC);

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

        const comparison =
            compareHands(
                hands[i].hand,
                winner.hand
            );

        if (comparison > 0) {

            winner = hands[i];
        }
    }

    return {

        cards: {

            A: cardsA.map(cardText),

            B: cardsB.map(cardText),

            C: cardsC.map(cardText)
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
// PLACE BET
//
// IMPORTANT:
// Existing betting/balance logic yahan intentionally
// nahi badla gaya.
// =====================================================

app.post("/placeTeenPattiBet", async (req, res) => {

    try {

        const {
            uid,
            side,
            amount,
            roundId
        } = req.body;

        if (!uid || !side || !amount || !roundId) {

            return res.status(400).json({
                success: false,
                error: "Invalid bet data"
            });
        }

        // -------------------------------------------------
        // YAHAN TUMHARA EXISTING BET LOGIC RAHEGA.
        // Balance deduction / demand update ko yahan
        // apne current working code se replace karo.
        // -------------------------------------------------

        return res.status(200).json({

            success: true,

            message: "Bet placed successfully",

            side: Number(side),

            amount: Number(amount),

            roundId: String(roundId)
        });

    } catch (error) {

        console.error("placeTeenPattiBet:", error);

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =====================================================
// GET ROUND RESULT
// =====================================================

app.post("/getTeenPattiRound", async (req, res) => {

    try {

        const { roundId } = req.body;

        if (!roundId) {

            return res.status(400).json({
                success: false,
                error: "roundId required"
            });
        }

        const roundRef =
            db
                .ref("global_teen_patti")
                .child("rounds")
                .child(String(roundId));

        // -------------------------------------------------
        // FIRST READ
        // -------------------------------------------------

        const snapshot =
            await roundRef.once("value");

        let round = snapshot.val();

        // -------------------------------------------------
        // AGAR RESULT PEHLE SE BAN CHUKA HAI
        // TO SAME RESULT RETURN KARO
        // -------------------------------------------------

        if (
            round &&
            round.cards &&
            round.hands &&
            round.winner
        ) {

            return res.status(200).json({

                success: true,

                bettingOpen: false,

                cards: round.cards,

                hands: round.hands,

                winner: Number(round.winner),

                generatedAt: round.generatedAt || 0
            });
        }

        // -------------------------------------------------
        // ROUND START TIME
        //
        // Agar roundId timestamp hai to usko use karo.
        // -------------------------------------------------

        let startTime = Number(roundId);

        if (
            !Number.isFinite(startTime) ||
            startTime <= 0
        ) {

            if (
                round &&
                round.startTime
            ) {

                startTime =
                    Number(round.startTime);

            } else {

                startTime = Date.now();

                await roundRef.child("startTime")
                    .set(startTime);
            }
        }

        const now = Date.now();

        const elapsed =
            now - startTime;

        // -------------------------------------------------
        // BETTING ABHI OPEN HAI
        // -------------------------------------------------

        if (elapsed < BETTING_MS) {

            return res.status(200).json({

                success: true,

                bettingOpen: true,

                remainingMs:
                    Math.max(
                        0,
                        BETTING_MS - elapsed
                    ),

                cards: null,

                hands: null,

                winner: 0
            });
        }

        // -------------------------------------------------
        // BETTING CLOSE
        // RESULT CREATE KARO
        // -------------------------------------------------

        const result =
            createRoundResult();

        // -------------------------------------------------
        // TRANSACTION
        //
        // Multiple users same time request karein,
        // tab bhi sirf ek result save hoga.
        // -------------------------------------------------

        const transaction =
            await roundRef.transaction(
                current => {

                    if (
                        current &&
                        current.cards &&
                        current.hands &&
                        current.winner
                    ) {

                        return;
                    }

                    return {
                        startTime: startTime,

                        cards: result.cards,

                        hands: result.hands,

                        winner: result.winner,

                        generatedAt: result.generatedAt
                    };
                }
            );

        const finalSnapshot =
            await roundRef.once("value");

        const finalRound =
            finalSnapshot.val();

        // -------------------------------------------------
        // FINAL RESULT
        // -------------------------------------------------

        if (
            finalRound &&
            finalRound.cards
        ) {

            return res.status(200).json({

                success: true,

                bettingOpen: false,

                cards: finalRound.cards,

                hands: finalRound.hands,

                winner:
                    Number(finalRound.winner),

                generatedAt:
                    finalRound.generatedAt || 0
            });
        }

        return res.status(500).json({

            success: false,

            error: "Round result could not be created"
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
//
// Existing settlement logic yahan rahega.
// =====================================================

app.post("/settleTeenPattiRound", async (req, res) => {

    try {

        const { roundId } = req.body;

        if (!roundId) {

            return res.status(400).json({
                success: false,
                error: "roundId required"
            });
        }

        return res.status(200).json({

            success: true,

            message: "Settled",

            roundId: String(roundId)
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
// SERVER
// =====================================================

const PORT =
    process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `Teen Patti server running on port ${PORT}`
    );

});
