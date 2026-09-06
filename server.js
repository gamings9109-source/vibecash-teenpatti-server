const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");

// =====================================================
// FIREBASE INITIALIZATION
// =====================================================

const FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL;

if (!FIREBASE_DATABASE_URL) {

    console.error(
        "ERROR: FIREBASE_DATABASE_URL environment variable is missing."
    );

    process.exit(1);
}

admin.initializeApp({
    databaseURL: FIREBASE_DATABASE_URL
});

const db = admin.database();

// =====================================================
// EXPRESS
// =====================================================

const app = express();

app.use(cors());

app.use(
    express.json({
        limit: "1mb"
    })
);

// =====================================================
// TEEN PATTI SETTINGS
// =====================================================

const ROUND_TOTAL_MS = 23400;
const BETTING_MS = 17000;

// 1 = A
// 2 = B
// 3 = C

const SUITS = [
    "♠",
    "♥",
    "♦",
    "♣"
];

const RANKS = [
    {
        name: "2",
        value: 2
    },
    {
        name: "3",
        value: 3
    },
    {
        name: "4",
        value: 4
    },
    {
        name: "5",
        value: 5
    },
    {
        name: "6",
        value: 6
    },
    {
        name: "7",
        value: 7
    },
    {
        name: "8",
        value: 8
    },
    {
        name: "9",
        value: 9
    },
    {
        name: "10",
        value: 10
    },
    {
        name: "J",
        value: 11
    },
    {
        name: "Q",
        value: 12
    },
    {
        name: "K",
        value: 13
    },
    {
        name: "A",
        value: 14
    }
];

// =====================================================
// SECURE RANDOM
// =====================================================

function secureRandom(max) {

    return crypto.randomInt(
        0,
        max
    );
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

    const shuffled = [
        ...deck
    ];

    for (
        let i = shuffled.length - 1;
        i > 0;
        i--
    ) {

        const j =
            secureRandom(i + 1);

        const temp =
            shuffled[i];

        shuffled[i] =
            shuffled[j];

        shuffled[j] =
            temp;
    }

    return shuffled;
}

// =====================================================
// EVALUATE HAND
// =====================================================

function evaluateHand(cards) {

    const values = cards
        .map(
            card =>
                Number(card.value)
        )
        .sort(
            (a, b) =>
                b - a
        );

    const suits =
        cards.map(
            card =>
                card.suit
        );

    const sameSuit =
        suits.length === 3 &&
        suits[0] === suits[1] &&
        suits[1] === suits[2];

    const counts = {};

    for (const value of values) {

        counts[value] =
            (counts[value] || 0) + 1;
    }

    const countValues =
        Object.values(counts);

    // =================================================
    // TRAIL
    // =================================================

    if (
        countValues.includes(3)
    ) {

        return {

            name: "Trail",

            rank: 6,

            tie: [
                values[0]
            ]
        };
    }

    // =================================================
    // STRAIGHT
    // =================================================

    let straight =
        false;

    let straightHigh =
        values[0];

    // A-2-3
    if (
        values[0] === 14 &&
        values[1] === 3 &&
        values[2] === 2
    ) {

        straight =
            true;

        straightHigh =
            3;

    } else {

        straight =
            values[0] ===
                values[1] + 1 &&
            values[1] ===
                values[2] + 1;
    }

    // =================================================
    // STRAIGHT FLUSH
    // =================================================

    if (
        straight &&
        sameSuit
    ) {

        return {

            name: "Straight Flush",

            rank: 5,

            tie: [
                straightHigh
            ]
        };
    }

    // =================================================
    // FLUSH
    // =================================================

    if (sameSuit) {

        return {

            name: "Flush",

            rank: 4,

            tie: values
        };
    }

    // =================================================
    // STRAIGHT
    // =================================================

    if (straight) {

        return {

            name: "Straight",

            rank: 3,

            tie: [
                straightHigh
            ]
        };
    }

    // =================================================
    // PAIR
    // =================================================

    if (
        countValues.includes(2)
    ) {

        let pairValue =
            0;

        let kicker =
            0;

        for (
            const value of values
        ) {

            if (
                counts[value] === 2
            ) {

                pairValue =
                    Math.max(
                        pairValue,
                        value
                    );

            } else {

                kicker =
                    Math.max(
                        kicker,
                        value
                    );
            }
        }

        return {

            name: "Pair",

            rank: 2,

            tie: [
                pairValue,
                kicker
            ]
        };
    }

    // =================================================
    // HIGH CARD
    // =================================================

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

    if (
        a.rank !== b.rank
    ) {

        return (
            a.rank > b.rank
                ? 1
                : -1
        );
    }

    const length =
        Math.max(
            a.tie.length,
            b.tie.length
        );

    for (
        let i = 0;
        i < length;
        i++
    ) {

        const av =
            a.tie[i] || 0;

        const bv =
            b.tie[i] || 0;

        if (
            av !== bv
        ) {

            return (
                av > bv
                    ? 1
                    : -1
            );
        }
    }

    return 0;
}

// =====================================================
// CREATE ROUND RESULT
// =====================================================

function createRoundResult() {

    const deck =
        shuffleDeck(
            createDeck()
        );

    // =================================================
    // EXACTLY 9 UNIQUE CARDS
    // =================================================

    const cardsA =
        deck.slice(
            0,
            3
        );

    const cardsB =
        deck.slice(
            3,
            6
        );

    const cardsC =
        deck.slice(
            6,
            9
        );

    // =================================================
    // EVALUATE
    // =================================================

    const handA =
        evaluateHand(
            cardsA
        );

    const handB =
        evaluateHand(
            cardsB
        );

    const handC =
        evaluateHand(
            cardsC
        );

    // =================================================
    // FIND WINNER
    // =================================================

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

    let winner =
        hands[0];

    for (
        let i = 1;
        i < hands.length;
        i++
    ) {

        const comparison =
            compareHands(
                hands[i].hand,
                winner.hand
            );

        if (
            comparison > 0
        ) {

            winner =
                hands[i];
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

        winner:
            Number(
                winner.seat
            ),

        generatedAt:
            Date.now()
    };
}

// =====================================================
// VALIDATE ROUND RESULT
// =====================================================

function isValidRoundResult(round) {

    if (!round) {
        return false;
    }

    if (!round.cards) {
        return false;
    }

    if (
        !Array.isArray(
            round.cards.A
        )
    ) {
        return false;
    }

    if (
        !Array.isArray(
            round.cards.B
        )
    ) {
        return false;
    }

    if (
        !Array.isArray(
            round.cards.C
        )
    ) {
        return false;
    }

    if (
        round.cards.A.length !== 3
    ) {
        return false;
    }

    if (
        round.cards.B.length !== 3
    ) {
        return false;
    }

    if (
        round.cards.C.length !== 3
    ) {
        return false;
    }

    const winner =
        Number(
            round.winner
        );

    if (
        winner !== 1 &&
        winner !== 2 &&
        winner !== 3
    ) {
        return false;
    }

    return true;
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.status(200).send(
            "VibeCash Teen Patti Server OK"
        );
    }
);

// =====================================================
// SERVER TIME TEST
// =====================================================

app.get(
    "/health",
    (req, res) => {

        res.status(200).json({

            success: true,

            server: "online",

            time: Date.now(),

            roundTotalMs:
                ROUND_TOTAL_MS,

            bettingMs:
                BETTING_MS
        });
    }
);

// =====================================================
// TEST CARD GENERATION
// =====================================================

app.get(
    "/testRound",
    (req, res) => {

        try {

            const result =
                createRoundResult();

            console.log(
                "========== TEST ROUND =========="
            );

            console.log(
                JSON.stringify(
                    result,
                    null,
                    2
                )
            );

            console.log(
                "================================"
            );

            return res.status(200).json({

                success: true,

                cards:
                    result.cards,

                hands:
                    result.hands,

                winner:
                    result.winner,

                generatedAt:
                    result.generatedAt
            });

        } catch (error) {

            console.error(
                "TEST ROUND ERROR:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);

// =====================================================
// PLACE BET
// =====================================================

app.post(
    "/placeTeenPattiBet",
    async (req, res) => {

        try {

            const {
                uid,
                side,
                amount,
                roundId
            } = req.body;

            console.log(
                "========== PLACE BET =========="
            );

            console.log(
                "uid:",
                uid
            );

            console.log(
                "side:",
                side
            );

            console.log(
                "amount:",
                amount
            );

            console.log(
                "roundId:",
                roundId
            );

            console.log(
                "================================"
            );

            // -----------------------------------------
            // VALIDATION
            // -----------------------------------------

            if (
                !uid ||
                side === undefined ||
                amount === undefined ||
                !roundId
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid bet data"
                });
            }

            const sideNumber =
                Number(side);

            const amountNumber =
                Number(amount);

            if (
                !Number.isFinite(
                    sideNumber
                ) ||
                !Number.isFinite(
                    amountNumber
                )
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid side or amount"
                });
            }

            if (
                sideNumber < 1 ||
                sideNumber > 3
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid side"
                });
            }

            if (
                amountNumber <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid amount"
                });
            }

            // -----------------------------------------
            // BETTING TIME CHECK
            // -----------------------------------------

            const roundNumber =
                Number(roundId);

            if (
                !Number.isFinite(
                    roundNumber
                ) ||
                roundNumber <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid roundId"
                });
            }

            const startTime =
                roundNumber *
                ROUND_TOTAL_MS;

            const elapsed =
                Date.now() -
                startTime;

            if (
                elapsed < 0 ||
                elapsed >= BETTING_MS
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Betting is closed"
                });
            }

            // -----------------------------------------
            // IMPORTANT
            //
            // Existing client/Firebase demand logic
            // is not changed here.
            // -----------------------------------------

            return res.status(200).json({

                success: true,

                message:
                    "Bet placed successfully",

                side:
                    sideNumber,

                amount:
                    amountNumber,

                roundId:
                    String(
                        roundId
                    )
            });

        } catch (error) {

            console.error(
                "PLACE BET ERROR:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);

// =====================================================
// GET TEEN PATTI ROUND
// =====================================================

app.post(
    "/getTeenPattiRound",
    async (req, res) => {

        try {

            console.log(
                "================================="
            );

            console.log(
                "GET ROUND REQUEST"
            );

            console.log(
                "BODY:",
                JSON.stringify(
                    req.body
                )
            );

            console.log(
                "SERVER TIME:",
                Date.now()
            );

            console.log(
                "================================="
            );

            const {
                roundId
            } = req.body;

            // -----------------------------------------
            // VALIDATE
            // -----------------------------------------

            if (!roundId) {

                return res.status(400).json({

                    success: false,

                    error:
                        "roundId required"
                });
            }

            const id =
                String(
                    roundId
                );

            const roundNumber =
                Number(
                    roundId
                );

            if (
                !Number.isFinite(
                    roundNumber
                ) ||
                roundNumber <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid roundId"
                });
            }

            // -----------------------------------------
            // FIREBASE ROUND
            // -----------------------------------------

            const roundRef =
                db
                    .ref(
                        "global_teen_patti"
                    )
                    .child(
                        "rounds"
                    )
                    .child(
                        id
                    );

            // -----------------------------------------
            // ANDROID ROUND ID FORMULA
            //
            // roundId =
            // floor(currentTime / 23400)
            //
            // Therefore:
            //
            // startTime =
            // roundId * 23400
            // -----------------------------------------

            const startTime =
                roundNumber *
                ROUND_TOTAL_MS;

            const now =
                Date.now();

            const elapsed =
                now -
                startTime;

            console.log(
                "roundId:",
                id
            );

            console.log(
                "startTime:",
                startTime
            );

            console.log(
                "now:",
                now
            );

            console.log(
                "elapsed:",
                elapsed
            );

            // -----------------------------------------
            // READ EXISTING ROUND
            // -----------------------------------------

            const existingSnapshot =
                await roundRef.once(
                    "value"
                );

            const existing =
                existingSnapshot.val();

            // -----------------------------------------
            // EXISTING RESULT
            // -----------------------------------------

            if (
                isValidRoundResult(
                    existing
                )
            ) {

                console.log(
                    "EXISTING RESULT FOUND"
                );

                return res.status(200).json({

                    success: true,

                    roundId:
                        id,

                    bettingOpen:
                        false,

                    cards:
                        existing.cards,

                    hands:
                        existing.hands || {},

                    winner:
                        Number(
                            existing.winner
                        ),

                    generatedAt:
                        Number(
                            existing.generatedAt ||
                            0
                        )
                });
            }

            // -----------------------------------------
            // BETTING OPEN
            // -----------------------------------------

            if (
                elapsed < BETTING_MS
            ) {

                const remainingMs =
                    Math.max(
                        0,
                        BETTING_MS -
                        elapsed
                    );

                console.log(
                    "BETTING OPEN"
                );

                console.log(
                    "remainingMs:",
                    remainingMs
                );

                return res.status(200).json({

                    success: true,

                    roundId:
                        id,

                    bettingOpen:
                        true,

                    remainingMs:
                        remainingMs,

                    cards:
                        null,

                    hands:
                        null,

                    winner:
                        0
                });
            }

            // -----------------------------------------
            // BETTING CLOSED
            // -----------------------------------------

            console.log(
                "BETTING CLOSED"
            );

            // -----------------------------------------
            // GENERATE RESULT
            // -----------------------------------------

            const generated =
                createRoundResult();

            console.log(
                "GENERATED RESULT:"
            );

            console.log(
                JSON.stringify(
                    generated,
                    null,
                    2
                )
            );

            // -----------------------------------------
            // SAVE RESULT ONLY ONCE
            // -----------------------------------------

            await roundRef.transaction(
                current => {

                    if (
                        isValidRoundResult(
                            current
                        )
                    ) {

                        return;
                    }

                    return {

                        startTime:
                            startTime,

                        cards:
                            generated.cards,

                        hands:
                            generated.hands,

                        winner:
                            generated.winner,

                        generatedAt:
                            generated.generatedAt
                    };
                }
            );

            // -----------------------------------------
            // READ FINAL RESULT
            // -----------------------------------------

            const finalSnapshot =
                await roundRef.once(
                    "value"
                );

            const finalRound =
                finalSnapshot.val();

            console.log(
                "FINAL ROUND:"
            );

            console.log(
                JSON.stringify(
                    finalRound,
                    null,
                    2
                )
            );

            // -----------------------------------------
            // VALIDATE
            // -----------------------------------------

            if (
                !isValidRoundResult(
                    finalRound
                )
            ) {

                console.error(
                    "INVALID FINAL ROUND"
                );

                return res.status(500).json({

                    success: false,

                    error:
                        "Round result could not be created"
                });
            }

            // -----------------------------------------
            // SEND RESULT
            // -----------------------------------------

            const response = {

                success: true,

                roundId:
                    id,

                bettingOpen:
                    false,

                cards: {

                    A:
                        finalRound.cards.A,

                    B:
                        finalRound.cards.B,

                    C:
                        finalRound.cards.C
                },

                hands:
                    finalRound.hands || {},

                winner:
                    Number(
                        finalRound.winner
                    ),

                generatedAt:
                    Number(
                        finalRound.generatedAt ||
                        0
                    )
            };

            console.log(
                "========== RESULT SENT =========="
            );

            console.log(
                JSON.stringify(
                    response,
                    null,
                    2
                )
            );

            console.log(
                "================================="
            );

            return res.status(200).json(
                response
            );

        } catch (error) {

            console.error(
                "================================="
            );

            console.error(
                "GET ROUND ERROR"
            );

            console.error(
                error
            );

            console.error(
                error.stack
            );

            console.error(
                "================================="
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);

// =====================================================
// SETTLE ROUND
// =====================================================

app.post(
    "/settleTeenPattiRound",
    async (req, res) => {

        try {

            const {
                roundId
            } = req.body;

            console.log(
                "========== SETTLE ROUND =========="
            );

            console.log(
                "roundId:",
                roundId
            );

            console.log(
                "=================================="
            );

            if (!roundId) {

                return res.status(400).json({

                    success: false,

                    error:
                        "roundId required"
                });
            }

            return res.status(200).json({

                success: true,

                message:
                    "Settled",

                roundId:
                    String(
                        roundId
                    )
            });

        } catch (error) {

            console.error(
                "SETTLE ROUND ERROR:",
                error
            );

            return res.status(500).json({

                success: false,

                error:
                    error.message
            });
        }
    }
);

// =====================================================
// 404
// =====================================================

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "Endpoint not found",

            path:
                req.path
        });
    }
);

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(
                error
            );
        }

        res.status(500).json({

            success: false,

            error:
                error.message ||
                "Server error"
        });
    }
);

// =====================================================
// START SERVER
// =====================================================

const PORT =
    Number(
        process.env.PORT
    ) || 10000;

const HOST =
    "0.0.0.0";

const server =
    app.listen(
        PORT,
        HOST,
        () => {

            console.log(
                "================================="
            );

            console.log(
                "VIBECASH TEEN PATTI SERVER"
            );

            console.log(
                "STATUS: ONLINE"
            );

            console.log(
                "HOST:",
                HOST
            );

            console.log(
                "PORT:",
                PORT
            );

            console.log(
                "ROUND_TOTAL_MS:",
                ROUND_TOTAL_MS
            );

            console.log(
                "BETTING_MS:",
                BETTING_MS
            );

            console.log(
                "FIREBASE_DATABASE_URL:",
                FIREBASE_DATABASE_URL
                    ? "CONFIGURED"
                    : "MISSING"
            );

            console.log(
                "================================="
            );
        }
    );

// =====================================================
// SERVER ERROR
// =====================================================

server.on(
    "error",
    error => {

        console.error(
            "SERVER LISTEN ERROR:",
            error
        );

        process.exit(1);
    }
);

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

process.on(
    "SIGTERM",
    () => {

        console.log(
            "SIGTERM received."
        );

        server.close(
            () => {

                console.log(
                    "Server closed."
                );

                process.exit(0);
            }
        );
    }
);

process.on(
    "SIGINT",
    () => {

        console.log(
            "SIGINT received."
        );

        server.close(
            () => {

                console.log(
                    "Server closed."
                );

                process.exit(0);
            }
        );
    }
);
