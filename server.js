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

const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

// =====================================================
// CHECK FIREBASE CONFIG
// =====================================================

if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error(
        "FIREBASE_DATABASE_URL environment variable is missing"
    );
}

// =====================================================
// READ FIREBASE SERVICE ACCOUNT
// =====================================================

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
        "Firebase service account file is missing: " +
        SERVICE_ACCOUNT_PATH
    );
}

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
        admin.credential.cert(serviceAccount),

    databaseURL:
        process.env.FIREBASE_DATABASE_URL

});

// =====================================================
// FIREBASE DATABASE
// =====================================================

const db = admin.database();

const roundRef = db
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

        const temp = deck[i];

        deck[i] = deck[j];

        deck[j] = temp;
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
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {

    res.status(200).json({

        ok: true,

        server:
            "Teen Patti Server",

        status:
            "running",

        room_id:
            ROOM_ID

    });

});

// =====================================================
// GET CURRENT ROUND
// =====================================================

app.get("/round", async (req, res) => {

    try {

        const snapshot =
            await roundRef.once("value");

        const data =
            snapshot.val();

        if (!data) {

            return res.status(404).json({

                ok: false,

                error:
                    "No round found"

            });

        }

        res.json({

            ok: true,

            round: data

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

});

// =====================================================
// START NEW ROUND
// =====================================================

app.post("/start-round", async (req, res) => {

    try {

        // =================================================
        // ADMIN SECRET CHECK
        // =================================================

        const secret =
            process.env.ADMIN_SECRET;

        if (!secret) {

            return res.status(500).json({

                ok: false,

                error:
                    "ADMIN_SECRET is not configured"

            });

        }

        const suppliedSecret =
            req.headers["x-admin-secret"];

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

        // =================================================
        // READ CURRENT ROUND
        // =================================================

        const snapshot =
            await roundRef.once("value");

        const current =
            snapshot.val() || {};

        let oldRoundId =
            Number(
                current.round_id || 0
            );

        if (
            !Number.isFinite(
                oldRoundId
            )
        ) {

            oldRoundId = 0;

        }

        // =================================================
        // NEW ROUND ID
        // =================================================

        const newRoundId =
            oldRoundId + 1;

        // =================================================
        // GENERATE CARDS ON SERVER
        // =================================================

        const cards =
            generateNineCards();

        // =================================================
        // SERVER TIME
        // =================================================

        const now =
            Date.now();

        // =================================================
        // WAIT 10 SECONDS
        // =================================================

        const revealAt =
            now + 10000;

        // =================================================
        // SAVE ROUND TO FIREBASE
        // =================================================

        await roundRef.set({

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

        });

        console.log(
            "================================="
        );

        console.log(
            `Round ${newRoundId} CREATED`
        );

        console.log(
            "Reveal at:",
            new Date(
                revealAt
            ).toISOString()
        );

        console.log(
            "================================="
        );

        // =================================================
        // REVEAL AFTER 10 SECONDS
        // =================================================

        setTimeout(
            async () => {

                try {

                    const latestSnapshot =
                        await roundRef.once(
                            "value"
                        );

                    const latest =
                        latestSnapshot.val();

                    // -----------------------------------------
                    // Only reveal if this is still
                    // the current round
                    // -----------------------------------------

                    if (
                        latest &&
                        String(
                            latest.round_id
                        ) ===
                        String(
                            newRoundId
                        )
                    ) {

                        await roundRef.update({

                            status:
                                "reveal",

                            revealed_at:
                                Date.now()

                        });

                        console.log(
                            `Round ${newRoundId} REVEALED`
                        );

                    }

                } catch (error) {

                    console.error(
                        "Reveal error:",
                        error
                    );

                }

            },
            10000
        );

        // =================================================
        // RESPONSE
        // =================================================

        res.status(200).json({

            ok: true,

            room_id:
                ROOM_ID,

            round_id:
                String(newRoundId),

            status:
                "waiting",

            started_at:
                now,

            reveal_at:
                revealAt

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

});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {

    res.status(404).json({

        ok: false,

        error:
            "Endpoint not found"

    });

});

// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            "Teen Patti Server Started"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `Room: ${ROOM_ID}`
        );

        console.log(
            "Firebase Admin: Connected"
        );

        console.log(
            "================================="
        );

    }
);
