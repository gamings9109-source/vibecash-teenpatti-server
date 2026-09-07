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

// 20 seconds countdown
const WAITING_TIME = 20000;

// Cards 5 seconds visible
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
// CHECK SERVICE ACCOUNT FILE
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
// CREATE NEW ROUND
// =====================================================

async function createNewRound() {

    // -------------------------------------------------
    // READ CURRENT ROUND
    // -------------------------------------------------

    const snapshot =
        await roundRef.once("value");

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
    // GENERATE COMPLETELY NEW CARDS
    // -------------------------------------------------

    const cards =
        generateNineCards();

    // -------------------------------------------------
    // CURRENT SERVER TIME
    // -------------------------------------------------

    const now =
        Date.now();

    // -------------------------------------------------
    // REVEAL TIME
    // 20 SECONDS FROM NOW
    // -------------------------------------------------

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

        }

    };

    // -------------------------------------------------
    // SAVE TO FIREBASE
    // -------------------------------------------------

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
        "STATUS: waiting"
    );

    console.log(
        "20 SECOND COUNTDOWN STARTED"
    );

    console.log(
        "REVEAL AT:",
        new Date(
            revealAt
        ).toISOString()
    );

    console.log(
        "CARDS:",
        cards
    );

    console.log(
        "========================================"
    );

    // -------------------------------------------------
    // START 20 SECOND TIMER
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

                // -------------------------------------
                // READ LATEST ROUND
                // -------------------------------------

                const snapshot =
                    await roundRef.once(
                        "value"
                    );

                const latest =
                    snapshot.val();

                // -------------------------------------
                // MAKE SURE THIS IS STILL
                // THE CURRENT ROUND
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
                // ONLY REVEAL IF STILL WAITING
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
                // CHANGE TO REVEAL
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
                    "CARDS ARE VISIBLE FOR 5 SECONDS"
                );

                // -------------------------------------
                // AFTER 5 SECONDS
                // CREATE NEXT ROUND
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

                            // -----------------------------
                            // CHECK SAME ROUND
                            // -----------------------------

                            if (
                                !latestRound ||
                                String(
                                    latestRound.round_id
                                ) !==
                                String(roundId)
                            ) {

                                console.log(
                                    `Round ${roundId} is no longer current`
                                );

                                return;
                            }

                            // -----------------------------
                            // CREATE NEXT ROUND
                            // -----------------------------

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
// RESUME EXISTING ROUND AFTER SERVER RESTART
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
        // WAITING ROUND
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
        // WAITING BUT TIMER ALREADY FINISHED
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
                            ) === roundId
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
                `Reveal already active. Next round in ${delay} ms`
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
                            ) === roundId &&
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
        // UNKNOWN STATUS
        // -------------------------------------------------

        console.log(
            "Unknown round status."
        );

        console.log(
            "Creating a fresh round..."
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

            // -----------------------------------------
            // CHECK SECRET
            // -----------------------------------------

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

            // -----------------------------------------
            // CREATE ROUND
            // -----------------------------------------

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
// TEMPORARY BROWSER START
// =====================================================
//
// TEST ONLY.
//
// Example:
// /test-start-round?secret=YOUR_SECRET
//
// After testing remove this endpoint.
// =====================================================

app.get(
    "/test-start-round",
    async (req, res) => {

        try {

            const secret =
                process.env.ADMIN_SECRET;

            if (
                req.query.secret !==
                secret
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
                    "Test round created",

                room_id:
                    ROOM_ID,

                round:
                    result

            });

        } catch (error) {

            console.error(
                "Test round error:",
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
            "========================================"
        );

        // ---------------------------------------------
        // RESUME / START ROUND
        // ---------------------------------------------

        await resumeExistingRound();

    }
);
