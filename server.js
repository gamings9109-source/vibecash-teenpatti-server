const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");

const app = express();

app.use(express.json());

// =====================================================
// SERVER CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;

const ROOM_ID = "567943";

// 20 seconds cards hidden
const WAITING_TIME = 20000;

// 5 seconds cards visible
const REVEAL_TIME = 5000;

const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

// =====================================================
// CHECK ENVIRONMENT
// =====================================================

if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error(
        "FIREBASE_DATABASE_URL environment variable is missing"
    );
}

if (!process.env.ADMIN_SECRET) {
    throw new Error(
        "ADMIN_SECRET environment variable is missing"
    );
}

// =====================================================
// CHECK SERVICE ACCOUNT
// =====================================================

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
        "Firebase service account file is missing: " +
        SERVICE_ACCOUNT_PATH
    );
}

// =====================================================
// READ SERVICE ACCOUNT
// =====================================================

let serviceAccount;

try {

    const jsonText =
        fs.readFileSync(
            SERVICE_ACCOUNT_PATH,
            "utf8"
        );

    serviceAccount =
        JSON.parse(jsonText);

} catch (error) {

    throw new Error(
        "Firebase service account JSON is invalid: " +
        error.message
    );
}

// =====================================================
// FIREBASE ADMIN INITIALIZE
// =====================================================

admin.initializeApp({

    credential:
        admin.credential.cert(
            serviceAccount
        ),

    databaseURL:
        process.env.FIREBASE_DATABASE_URL

});

// =====================================================
// FIREBASE DATABASE
// =====================================================

const db =
    admin.database();

const roundRef =
    db
        .ref("rooms")
        .child(ROOM_ID)
        .child("teen_patti")
        .child("round");

// =====================================================
// 52 CARD DECK
// =====================================================

const suits = [
    "♠",
    "♥",
    "♦",
    "♣"
];

const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K"
];

// =====================================================
// RANK VALUES
// =====================================================

const rankValues = {

    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    "J": 11,
    "Q": 12,
    "K": 13,
    "A": 14

};

// =====================================================
// CREATE DECK
// =====================================================

function createDeck() {

    const deck = [];

    for (const suit of suits) {

        for (const rank of ranks) {

            deck.push(
                `${rank}|${suit}`
            );

        }

    }

    return deck;
}

// =====================================================
// SECURE SHUFFLE
// =====================================================

function shuffle(deck) {

    for (
        let i = deck.length - 1;
        i > 0;
        i--
    ) {

        const j =
            crypto.randomInt(
                0,
                i + 1
            );

        const temp =
            deck[i];

        deck[i] =
            deck[j];

        deck[j] =
            temp;
    }

    return deck;
}

// =====================================================
// GENERATE 9 UNIQUE CARDS
// =====================================================

function generateNineCards() {

    const deck =
        createDeck();

    shuffle(deck);

    return {

        A1: deck[0],
        A2: deck[1],
        A3: deck[2],

        B1: deck[3],
        B2: deck[4],
        B3: deck[5],

        C1: deck[6],
        C2: deck[7],
        C3: deck[8]

    };
}

// =====================================================
// PARSE CARD
// =====================================================

function parseCard(card) {

    const parts =
        String(card).split("|");

    return {

        rank:
            parts[0],

        suit:
            parts[1]

    };
}

// =====================================================
// GET CARD VALUES
// =====================================================

function getCardValues(cards) {

    return cards
        .map(card => {

            const parsed =
                parseCard(card);

            return rankValues[
                parsed.rank
            ];

        })
        .sort(
            (a, b) => b - a
        );
}

// =====================================================
// CHECK THREE OF A KIND / TRAIL
// =====================================================

function isTrail(values) {

    return (
        values[0] === values[1] &&
        values[1] === values[2]
    );
}

// =====================================================
// CHECK FLUSH / COLOR
// =====================================================

function isColor(cards) {

    const parsed =
        cards.map(parseCard);

    return (
        parsed[0].suit ===
        parsed[1].suit &&
        parsed[1].suit ===
        parsed[2].suit
    );
}

// =====================================================
// CHECK SEQUENCE
// =====================================================

function getSequenceHigh(values) {

    const sorted =
        [...values].sort(
            (a, b) => a - b
        );

    // A-2-3 is lowest sequence
    if (
        sorted[0] === 2 &&
        sorted[1] === 3 &&
        sorted[2] === 14
    ) {

        return 3;
    }

    // Normal sequence
    if (
        sorted[1] ===
            sorted[0] + 1 &&
        sorted[2] ===
            sorted[1] + 1
    ) {

        return sorted[2];
    }

    return null;
}

// =====================================================
// CHECK PAIR
// =====================================================

function getPairInfo(values) {

    if (
        values[0] === values[1]
    ) {

        return {

            pair:
                values[0],

            kicker:
                values[2]

        };
    }

    if (
        values[1] === values[2]
    ) {

        return {

            pair:
                values[1],

            kicker:
                values[0]

        };
    }

    return null;
}

// =====================================================
// CALCULATE HAND
// =====================================================
//
// Priority:
//
// 6 = Trail
// 5 = Pure Sequence
// 4 = Sequence
// 3 = Color
// 2 = Pair
// 1 = High Card
//
// =====================================================

function calculateHand(cards) {

    const values =
        getCardValues(cards);

    const trail =
        isTrail(values);

    const color =
        isColor(cards);

    const sequenceHigh =
        getSequenceHigh(values);

    const pair =
        getPairInfo(values);

    // -------------------------------------------------
    // TRAIL
    // -------------------------------------------------

    if (trail) {

        return {

            category:
                "Trail",

            category_rank:
                6,

            compare:
                [
                    values[0]
                ]

        };
    }

    // -------------------------------------------------
    // PURE SEQUENCE
    // -------------------------------------------------

    if (
        color &&
        sequenceHigh !== null
    ) {

        return {

            category:
                "Pure Sequence",

            category_rank:
                5,

            compare:
                [
                    sequenceHigh
                ]

        };
    }

    // -------------------------------------------------
    // SEQUENCE
    // -------------------------------------------------

    if (
        sequenceHigh !== null
    ) {

        return {

            category:
                "Sequence",

            category_rank:
                4,

            compare:
                [
                    sequenceHigh
                ]

        };
    }

    // -------------------------------------------------
    // COLOR
    // -------------------------------------------------

    if (color) {

        return {

            category:
                "Color",

            category_rank:
                3,

            compare:
                values

        };
    }

    // -------------------------------------------------
    // PAIR
    // -------------------------------------------------

    if (pair) {

        return {

            category:
                "Pair",

            category_rank:
                2,

            compare:
                [
                    pair.pair,
                    pair.kicker
                ]

        };
    }

    // -------------------------------------------------
    // HIGH CARD
    // -------------------------------------------------

    return {

        category:
            "High Card",

        category_rank:
            1,

        compare:
            values

    };
}

// =====================================================
// COMPARE TWO HANDS
// =====================================================
//
// Returns:
//
// > 0 = first hand wins
// < 0 = second hand wins
// = 0 = tie
//
// =====================================================

function compareHands(first, second) {

    if (
        first.category_rank !==
        second.category_rank
    ) {

        return (
            first.category_rank -
            second.category_rank
        );
    }

    const firstCompare =
        first.compare || [];

    const secondCompare =
        second.compare || [];

    const length =
        Math.max(
            firstCompare.length,
            secondCompare.length
        );

    for (
        let i = 0;
        i < length;
        i++
    ) {

        const a =
            firstCompare[i] || 0;

        const b =
            secondCompare[i] || 0;

        if (a !== b) {

            return a - b;
        }
    }

    return 0;
}

// =====================================================
// CALCULATE A/B/C RESULTS + WINNER
// =====================================================

function calculateRoundResults(cards) {

    const handA =
        calculateHand([
            cards.A1,
            cards.A2,
            cards.A3
        ]);

    const handB =
        calculateHand([
            cards.B1,
            cards.B2,
            cards.B3
        ]);

    const handC =
        calculateHand([
            cards.C1,
            cards.C2,
            cards.C3
        ]);

    const hands = {

        A: handA,
        B: handB,
        C: handC

    };

    // -------------------------------------------------
    // FIND BEST HAND
    // -------------------------------------------------

    let winner =
        "A";

    let bestHand =
        handA;

    const compareB =
        compareHands(
            handB,
            bestHand
        );

    if (compareB > 0) {

        winner =
            "B";

        bestHand =
            handB;
    }

    const compareC =
        compareHands(
            handC,
            bestHand
        );

    if (compareC > 0) {

        winner =
            "C";

        bestHand =
            handC;
    }

    // -------------------------------------------------
    // CHECK TIE
    // -------------------------------------------------

    const tiedPlayers = [];

    if (
        compareHands(
            handA,
            bestHand
        ) === 0
    ) {

        tiedPlayers.push("A");
    }

    if (
        compareHands(
            handB,
            bestHand
        ) === 0
    ) {

        tiedPlayers.push("B");
    }

    if (
        compareHands(
            handC,
            bestHand
        ) === 0
    ) {

        tiedPlayers.push("C");
    }

    if (tiedPlayers.length > 1) {

        winner =
            tiedPlayers.join(",");

    }

    return {

        A: {

            category:
                handA.category,

            category_rank:
                handA.category_rank,

            compare:
                handA.compare

        },

        B: {

            category:
                handB.category,

            category_rank:
                handB.category_rank,

            compare:
                handB.compare

        },

        C: {

            category:
                handC.category,

            category_rank:
                handC.category_rank,

            compare:
                handC.compare

        },

        winner:
            winner

    };
}

// =====================================================
// CREATE NEW ROUND
// =====================================================

async function createNewRound() {

    // -------------------------------------------------
    // READ CURRENT ROUND
    // -------------------------------------------------

    const snapshot =
        await roundRef.once(
            "value"
        );

    const current =
        snapshot.val() || {};

    let oldRoundId =
        Number(
            current.round_id || 0
        );

    if (
        !Number.isFinite(oldRoundId)
    ) {

        oldRoundId = 0;
    }

    // -------------------------------------------------
    // NEW ROUND ID
    // -------------------------------------------------

    const newRoundId =
        oldRoundId + 1;

    // -------------------------------------------------
    // GENERATE NEW CARDS
    // -------------------------------------------------

    const cards =
        generateNineCards();

    // -------------------------------------------------
    // CALCULATE RESULTS
    // -------------------------------------------------

    const results =
        calculateRoundResults(
            cards
        );

    // -------------------------------------------------
    // SERVER TIME
    // -------------------------------------------------

    const now =
        Date.now();

    const revealAt =
        now + WAITING_TIME;

    // -------------------------------------------------
    // ROUND DATA
    // -------------------------------------------------

    const roundData = {

        round_id:
            String(newRoundId),

        status:
            "waiting",

        started_at:
            now,

        reveal_at:
            revealAt,

        cards: {

            A1: cards.A1,
            A2: cards.A2,
            A3: cards.A3,

            B1: cards.B1,
            B2: cards.B2,
            B3: cards.B3,

            C1: cards.C1,
            C2: cards.C2,
            C3: cards.C3

        },

        // -------------------------------------------------
        // RIBBON RESULTS
        // -------------------------------------------------

        results: {

            A: {

                category:
                    results.A.category,

                category_rank:
                    results.A.category_rank

            },

            B: {

                category:
                    results.B.category,

                category_rank:
                    results.B.category_rank

            },

            C: {

                category:
                    results.C.category,

                category_rank:
                    results.C.category_rank

            }

        },

        // -------------------------------------------------
        // WINNER
        // -------------------------------------------------

        winner:
            results.winner

    };

    // -------------------------------------------------
    // SAVE TO FIREBASE
    // -------------------------------------------------

    await roundRef.set(
        roundData
    );

    // -------------------------------------------------
    // LOG
    // -------------------------------------------------

    console.log(
        "========================================"
    );

    console.log(
        `ROUND ${newRoundId} CREATED`
    );

    console.log(
        "STATUS: waiting"
    );

    console.log(
        "WAITING: 20 SECONDS"
    );

    console.log(
        "REVEAL AT:",
        new Date(
            revealAt
        ).toISOString()
    );

    console.log(
        "A:",
        results.A.category
    );

    console.log(
        "B:",
        results.B.category
    );

    console.log(
        "C:",
        results.C.category
    );

    console.log(
        "WINNER:",
        results.winner
    );

    console.log(
        "CARDS:",
        cards
    );

    console.log(
        "========================================"
    );

    // -------------------------------------------------
    // SCHEDULE REVEAL
    // -------------------------------------------------

    scheduleReveal(
        String(newRoundId),
        revealAt
    );

    return roundData;
}

// =====================================================
// SCHEDULE REVEAL
// =====================================================

function scheduleReveal(
    roundId,
    revealAt
) {

    const delay =
        Math.max(
            0,
            revealAt - Date.now()
        );

    console.log(
        `Round ${roundId} will reveal in ${delay} ms`
    );

    setTimeout(
        async () => {

            try {

                const snapshot =
                    await roundRef.once(
                        "value"
                    );

                const latest =
                    snapshot.val();

                // -------------------------------------
                // CURRENT ROUND CHECK
                // -------------------------------------

                if (
                    !latest ||
                    String(
                        latest.round_id
                    ) !==
                    String(roundId)
                ) {

                    console.log(
                        `Round ${roundId} timer ignored`
                    );

                    return;
                }

                // -------------------------------------
                // ONLY WAITING CAN REVEAL
                // -------------------------------------

                if (
                    latest.status !==
                    "waiting"
                ) {

                    console.log(
                        `Round ${roundId} already changed`
                    );

                    return;
                }

                // -------------------------------------
                // REVEAL
                // -------------------------------------

                await roundRef.update({

                    status:
                        "reveal",

                    revealed_at:
                        Date.now()

                });

                console.log(
                    `ROUND ${roundId} REVEALED`
                );

                console.log(
                    "CARDS VISIBLE FOR 5 SECONDS"
                );

                // -------------------------------------
                // AFTER 5 SEC NEXT ROUND
                // -------------------------------------

                setTimeout(
                    async () => {

                        try {

                            const latestSnapshot =
                                await roundRef.once(
                                    "value"
                                );

                            const latestRound =
                                latestSnapshot.val();

                            if (
                                !latestRound ||
                                String(
                                    latestRound.round_id
                                ) !==
                                String(roundId)
                            ) {

                                console.log(
                                    `Round ${roundId} no longer current`
                                );

                                return;
                            }

                            console.log(
                                `ROUND ${roundId} 5 SECONDS FINISHED`
                            );

                            console.log(
                                "CREATING NEXT ROUND..."
                            );

                            await createNewRound();

                        } catch (error) {

                            console.error(
                                "Next round error:",
                                error
                            );

                        }

                    },
                    REVEAL_TIME
                );

            } catch (error) {

                console.error(
                    "Reveal error:",
                    error
                );

            }

        },
        delay
    );
}

// =====================================================
// RESUME EXISTING ROUND
// =====================================================

async function resumeExistingRound() {

    try {

        const snapshot =
            await roundRef.once(
                "value"
            );

        const round =
            snapshot.val();

        // -------------------------------------------------
        // NO ROUND
        // -------------------------------------------------

        if (!round) {

            console.log(
                "No existing round found."
            );

            console.log(
                "Creating first round..."
            );

            await createNewRound();

            return;
        }

        const roundId =
            String(
                round.round_id || "0"
            );

        const status =
            String(
                round.status || ""
            );

        const revealAt =
            Number(
                round.reveal_at || 0
            );

        console.log(
            "========================================"
        );

        console.log(
            "EXISTING ROUND FOUND"
        );

        console.log(
            "ROUND:",
            roundId
        );

        console.log(
            "STATUS:",
            status
        );

        console.log(
            "========================================"
        );

        // -------------------------------------------------
        // WAITING
        // -------------------------------------------------

        if (
            status === "waiting" &&
            revealAt > Date.now()
        ) {

            console.log(
                "Resuming waiting countdown..."
            );

            scheduleReveal(
                roundId,
                revealAt
            );

            return;
        }

        // -------------------------------------------------
        // WAITING BUT TIME FINISHED
        // -------------------------------------------------

        if (
            status === "waiting" &&
            revealAt <= Date.now()
        ) {

            await roundRef.update({

                status:
                    "reveal",

                revealed_at:
                    Date.now()

            });

            console.log(
                `ROUND ${roundId} REVEALED AFTER RESUME`
            );

            setTimeout(
                async () => {

                    try {

                        const latestSnapshot =
                            await roundRef.once(
                                "value"
                            );

                        const latest =
                            latestSnapshot.val();

                        if (
                            latest &&
                            String(
                                latest.round_id
                            ) ===
                            roundId
                        ) {

                            await createNewRound();

                        }

                    } catch (error) {

                        console.error(
                            "Resume next round error:",
                            error
                        );

                    }

                },
                REVEAL_TIME
            );

            return;
        }

        // -------------------------------------------------
        // ALREADY REVEAL
        // -------------------------------------------------

        if (
            status === "reveal"
        ) {

            const revealedAt =
                Number(
                    round.revealed_at || 0
                );

            const nextRoundAt =
                revealedAt +
                REVEAL_TIME;

            const delay =
                Math.max(
                    0,
                    nextRoundAt -
                    Date.now()
                );

            console.log(
                `Reveal active. Next round in ${delay} ms`
            );

            setTimeout(
                async () => {

                    try {

                        const latestSnapshot =
                            await roundRef.once(
                                "value"
                            );

                        const latest =
                            latestSnapshot.val();

                        if (
                            latest &&
                            String(
                                latest.round_id
                            ) ===
                            roundId &&
                            latest.status ===
                            "reveal"
                        ) {

                            await createNewRound();

                        }

                    } catch (error) {

                        console.error(
                            "Resume reveal error:",
                            error
                        );

                    }

                },
                delay
            );

            return;
        }

        // -------------------------------------------------
        // UNKNOWN
        // -------------------------------------------------

        console.log(
            "Unknown round status."
        );

        console.log(
            "Creating fresh round..."
        );

        await createNewRound();

    } catch (error) {

        console.error(
            "Resume error:",
            error
        );

    }
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.status(200).json({

            ok: true,

            server:
                "Teen Patti Server",

            status:
                "running",

            room_id:
                ROOM_ID,

            waiting_seconds:
                WAITING_TIME / 1000,

            reveal_seconds:
                REVEAL_TIME / 1000

        });

    }
);

// =====================================================
// GET CURRENT ROUND
// =====================================================

app.get(
    "/round",
    async (req, res) => {

        try {

            const snapshot =
                await roundRef.once(
                    "value"
                );

            const data =
                snapshot.val();

            if (!data) {

                return res.status(404).json({

                    ok: false,

                    error:
                        "No round found"

                });

            }

            res.status(200).json({

                ok: true,

                room_id:
                    ROOM_ID,

                round:
                    data

            });

        } catch (error) {

            console.error(
                "Get round error:",
                error
            );

            res.status(500).json({

                ok: false,

                error:
                    error.message

            });

        }

    }
);

// =====================================================
// START ROUND - ADMIN POST
// =====================================================

app.post(
    "/start-round",
    async (req, res) => {

        try {

            const secret =
                process.env.ADMIN_SECRET;

            const suppliedSecret =
                req.headers[
                    "x-admin-secret"
                ];

            if (
                !suppliedSecret ||
                suppliedSecret !== secret
            ) {

                return res.status(401).json({

                    ok: false,

                    error:
                        "Unauthorized"

                });

            }

            const result =
                await createNewRound();

            res.status(200).json({

                ok: true,

                message:
                    "New round created",

                room_id:
                    ROOM_ID,

                round:
                    result

            });

        } catch (error) {

            console.error(
                "Start round error:",
                error
            );

            res.status(500).json({

                ok: false,

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

            ok: false,

            error:
                "Endpoint not found"

        });

    }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    async () => {

        console.log(
            "========================================"
        );

        console.log(
            "TEEN PATTI SERVER STARTED"
        );

        console.log(
            `PORT: ${PORT}`
        );

        console.log(
            `ROOM: ${ROOM_ID}`
        );

        console.log(
            "FIREBASE ADMIN: CONNECTED"
        );

        console.log(
            "WAITING TIME: 20 SECONDS"
        );

        console.log(
            "REVEAL TIME: 5 SECONDS"
        );

        console.log(
            "WINNER CALCULATION: ENABLED"
        );

        console.log(
            "========================================"
        );

        await resumeExistingRound();

    }
);
