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

// Cards hidden for 20 seconds
const WAITING_TIME = 20 * 1000;

// Cards visible for 10 seconds
const REVEAL_TIME = 10 * 1000;

// Firebase check while server is awake
const RECONCILE_INTERVAL = 1000;

const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

// =====================================================
// ENVIRONMENT CHECK
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
// SERVICE ACCOUNT CHECK
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
// FIREBASE INITIALIZE
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
// ROUND LOCK
// =====================================================

let roundOperationRunning = false;

let reconcileRunning = false;

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
// CHECK TRAIL
// =====================================================

function isTrail(values) {

    return (
        values[0] === values[1] &&
        values[1] === values[2]
    );
}

// =====================================================
// CHECK COLOR
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

    // A-2-3
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

    // =================================================
    // TRAIL
    // =================================================

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

    // =================================================
    // PURE SEQUENCE
    // =================================================

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

    // =================================================
    // SEQUENCE
    // =================================================

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

    // =================================================
    // COLOR
    // =================================================

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

    // =================================================
    // PAIR
    // =================================================

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

    // =================================================
    // HIGH CARD
    // =================================================

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
// COMPARE HANDS
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
// CALCULATE RESULTS + WINNER
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

    // =================================================
    // CHECK TIE
    // =================================================

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

async function createNewRound(reason) {

    if (roundOperationRunning) {

        console.log(
            "CREATE ROUND: operation already running"
        );

        return null;
    }

    roundOperationRunning = true;

    try {

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

        const newRoundId =
            oldRoundId + 1;

        const cards =
            generateNineCards();

        const results =
            calculateRoundResults(
                cards
            );

        const now =
            Date.now();

        const revealAt =
            now + WAITING_TIME;

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

            winner:
                results.winner
        };

        await roundRef.set(
            roundData
        );

        console.log(
            "========================================"
        );

        console.log(
            `ROUND ${newRoundId} CREATED`
        );

        console.log(
            "REASON:",
            reason || "normal"
        );

        console.log(
            "STATUS: waiting"
        );

        console.log(
            "WAITING: 20 SECONDS"
        );

        console.log(
            "STARTED AT:",
            new Date(now).toISOString()
        );

        console.log(
            "REVEAL AT:",
            new Date(revealAt).toISOString()
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

        scheduleReveal(
            String(newRoundId),
            revealAt
        );

        return roundData;

    } catch (error) {

        console.error(
            "CREATE ROUND ERROR:",
            error
        );

        return null;

    } finally {

        roundOperationRunning = false;
    }
}

// =====================================================
// REVEAL ROUND
// =====================================================

async function revealRound(roundId) {

    try {

        const snapshot =
            await roundRef.once(
                "value"
            );

        const latest =
            snapshot.val();

        if (
            !latest ||
            String(latest.round_id) !==
            String(roundId)
        ) {

            console.log(
                `REVEAL ${roundId}: no longer current`
            );

            return false;
        }

        if (
            latest.status !==
            "waiting"
        ) {

            console.log(
                `REVEAL ${roundId}: status already ${latest.status}`
            );

            return false;
        }

        const revealedAt =
            Date.now();

        await roundRef.update({

            status:
                "reveal",

            revealed_at:
                revealedAt

        });

        console.log(
            `ROUND ${roundId} REVEALED`
        );

        console.log(
            "CARDS VISIBLE FOR 10 SECONDS"
        );

        scheduleNextRoundAfterReveal(
            roundId,
            revealedAt
        );

        return true;

    } catch (error) {

        console.error(
            "REVEAL ERROR:",
            error
        );

        return false;
    }
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
            Number(revealAt) -
            Date.now()
        );

    console.log(
        `Round ${roundId} will reveal in ${delay} ms`
    );

    setTimeout(
        async () => {

            try {

                await revealRound(
                    roundId
                );

            } catch (error) {

                console.error(
                    "SCHEDULE REVEAL ERROR:",
                    error
                );
            }

        },
        delay
    );
}

// =====================================================
// SCHEDULE NEXT ROUND
// =====================================================

function scheduleNextRoundAfterReveal(
    roundId,
    revealedAt
) {

    const nextRoundAt =
        Number(revealedAt) +
        REVEAL_TIME;

    const delay =
        Math.max(
            0,
            nextRoundAt -
            Date.now()
        );

    console.log(
        `Round ${roundId} next round in ${delay} ms`
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

                if (
                    !latest ||
                    String(latest.round_id) !==
                    String(roundId)
                ) {

                    console.log(
                        `ROUND ${roundId}: no longer current`
                    );

                    return;
                }

                if (
                    latest.status !==
                    "reveal"
                ) {

                    console.log(
                        `ROUND ${roundId}: status changed to ${latest.status}`
                    );

                    return;
                }

                console.log(
                    `ROUND ${roundId} 10 SECONDS FINISHED`
                );

                console.log(
                    "CREATING NEXT ROUND..."
                );

                await createNewRound(
                    "normal cycle"
                );

            } catch (error) {

                console.error(
                    "NEXT ROUND ERROR:",
                    error
                );
            }

        },
        delay
    );
}

// =====================================================
// RECONCILER
// =====================================================
//
// Runs every 1 second while server is awake.
// Firebase timestamps are used as source of truth.
//

async function reconcileRound() {

    if (reconcileRunning) {
        return;
    }

    reconcileRunning = true;

    try {

        const snapshot =
            await roundRef.once(
                "value"
            );

        const round =
            snapshot.val();

        // =================================================
        // NO ROUND
        // =================================================

        if (!round) {

            console.log(
                "RECONCILE: NO ROUND"
            );

            await createNewRound(
                "reconcile no round"
            );

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

        const now =
            Date.now();

        // =================================================
        // WAITING
        // =================================================

        if (
            status === "waiting"
        ) {

            if (revealAt <= 0) {

                console.log(
                    `RECONCILE: Round ${roundId} invalid reveal_at`
                );

                await createNewRound(
                    "invalid waiting round"
                );

                return;
            }

            if (now < revealAt) {

                return;
            }

            console.log(
                `RECONCILE: Round ${roundId} waiting finished`
            );

            await revealRound(
                roundId
            );

            return;
        }

        // =================================================
        // REVEAL
        // =================================================

        if (
            status === "reveal"
        ) {

            let revealedAt =
                Number(
                    round.revealed_at || 0
                );

            if (revealedAt <= 0) {

                revealedAt =
                    now;

                await roundRef.update({

                    revealed_at:
                        revealedAt

                });

                console.log(
                    `RECONCILE: Round ${roundId} missing revealed_at fixed`
                );

                return;
            }

            const nextRoundAt =
                revealedAt +
                REVEAL_TIME;

            if (now < nextRoundAt) {

                return;
            }

            console.log(
                `RECONCILE: Round ${roundId} 10-second reveal finished`
            );

            console.log(
                "RECONCILE: CREATING NEXT ROUND"
            );

            await createNewRound(
                "reconcile reveal finished"
            );

            return;
        }

        // =================================================
        // UNKNOWN STATUS
        // =================================================

        console.log(
            `RECONCILE: UNKNOWN STATUS "${status}"`
        );

        await createNewRound(
            "unknown status"
        );

    } catch (error) {

        console.error(
            "RECONCILE ERROR:",
            error
        );

    } finally {

        reconcileRunning = false;
    }
}

// =====================================================
// STARTUP RECOVERY
// =====================================================

async function resumeExistingRound() {

    try {

        const snapshot =
            await roundRef.once(
                "value"
            );

        const round =
            snapshot.val();

        // =================================================
        // NO ROUND
        // =================================================

        if (!round) {

            console.log(
                "STARTUP: NO EXISTING ROUND"
            );

            await createNewRound(
                "startup no round"
            );

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

        const now =
            Date.now();

        console.log(
            "========================================"
        );

        console.log(
            "STARTUP ROUND RECOVERY"
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
            "REVEAL AT:",
            revealAt
        );

        console.log(
            "SERVER NOW:",
            now
        );

        console.log(
            "========================================"
        );

        // =================================================
        // WAITING STILL ACTIVE
        // =================================================

        if (
            status === "waiting" &&
            revealAt > now
        ) {

            const remaining =
                revealAt - now;

            console.log(
                `STARTUP: Round ${roundId} still waiting`
            );

            console.log(
                `STARTUP: ${remaining} ms remaining`
            );

            scheduleReveal(
                roundId,
                revealAt
            );

            return;
        }

        // =================================================
        // WAITING EXPIRED
        // =================================================

        if (
            status === "waiting" &&
            revealAt <= now
        ) {

            console.log(
                `STARTUP: Round ${roundId} waiting expired`
            );

            console.log(
                "STARTUP: Creating fresh 20-second round"
            );

            await createNewRound(
                "startup expired waiting"
            );

            return;
        }

        // =================================================
        // REVEAL
        // =================================================

        if (
            status === "reveal"
        ) {

            let revealedAt =
                Number(
                    round.revealed_at || 0
                );

            if (revealedAt <= 0) {

                revealedAt =
                    now;

                await roundRef.update({

                    revealed_at:
                        revealedAt

                });

                console.log(
                    `STARTUP: Round ${roundId} missing revealed_at fixed`
                );
            }

            const revealEnd =
                revealedAt +
                REVEAL_TIME;

            // Reveal still active
            if (
                revealEnd > now
            ) {

                const remaining =
                    revealEnd - now;

                console.log(
                    `STARTUP: Round ${roundId} reveal active`
                );

                console.log(
                    `STARTUP: ${remaining} ms remaining`
                );

                scheduleNextRoundAfterReveal(
                    roundId,
                    revealedAt
                );

                return;
            }

            // Reveal finished
            console.log(
                `STARTUP: Round ${roundId} reveal already finished`
            );

            console.log(
                "STARTUP: Creating fresh round"
            );

            await createNewRound(
                "startup expired reveal"
            );

            return;
        }

        // =================================================
        // UNKNOWN STATUS
        // =================================================

        console.log(
            `STARTUP: Unknown status "${status}"`
        );

        await createNewRound(
            "startup unknown status"
        );

    } catch (error) {

        console.error(
            "STARTUP RECOVERY ERROR:",
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
                REVEAL_TIME / 1000,

            reconciler:
                "enabled",

            startup_recovery:
                "enabled"

        });
    }
);

// =====================================================
// HEALTH + CURRENT ROUND
// =====================================================

app.get(
    "/health",
    async (req, res) => {

        try {

            const snapshot =
                await roundRef.once(
                    "value"
                );

            const round =
                snapshot.val();

            res.status(200).json({

                ok: true,

                server:
                    "running",

                room_id:
                    ROOM_ID,

                round_id:
                    round
                        ? round.round_id
                        : null,

                round_status:
                    round
                        ? round.status
                        : null,

                waiting_seconds:
                    WAITING_TIME / 1000,

                reveal_seconds:
                    REVEAL_TIME / 1000,

                timestamp:
                    Date.now()

            });

        } catch (error) {

            console.error(
                "HEALTH ERROR:",
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
                "GET ROUND ERROR:",
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
// START ROUND - ADMIN
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
                await createNewRound(
                    "admin start"
                );

            if (!result) {

                return res.status(409).json({

                    ok: false,

                    error:
                        "Round operation already running"

                });
            }

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
                "START ROUND ERROR:",
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
// GLOBAL ERROR HANDLER
// =====================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "EXPRESS ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({

            ok: false,

            error:
                "Internal server error"

        });
    }
);

// =====================================================
// START SERVER
// =====================================================

const server =
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
                "REVEAL TIME: 10 SECONDS"
            );

            console.log(
                "WINNER CALCULATION: ENABLED"
            );

            console.log(
                "ROUND RECONCILER: ENABLED"
            );

            console.log(
                "STARTUP RECOVERY: ENABLED"
            );

            console.log(
                "SLEEP RECOVERY: ENABLED"
            );

            console.log(
                "========================================"
            );

            try {

                await resumeExistingRound();

            } catch (error) {

                console.error(
                    "STARTUP ROUND ERROR:",
                    error
                );
            }

            // =================================================
            // RECONCILER
            // =================================================

            setInterval(
                () => {

                    reconcileRound()
                        .catch(error => {

                            console.error(
                                "RECONCILER UNHANDLED ERROR:",
                                error
                            );

                        });

                },
                RECONCILE_INTERVAL
            );

            console.log(
                "RECONCILER STARTED"
            );
        }
    );

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

async function shutdown(signal) {

    console.log(
        `${signal} RECEIVED`
    );

    try {

        server.close(
            () => {

                console.log(
                    "HTTP SERVER CLOSED"
                );

                process.exit(0);
            }
        );

    } catch (error) {

        console.error(
            "SHUTDOWN ERROR:",
            error
        );

        process.exit(1);
    }
}

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);
