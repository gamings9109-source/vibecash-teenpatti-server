const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const ROOM_ID = "567943";

// =====================================================
// FIREBASE ADMIN
// =====================================================

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing");
}

if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error("FIREBASE_DATABASE_URL is missing");
}

const serviceAccount =
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

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

function createDeck() {
    const deck = [];

    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push(`${rank}|${suit}`);
        }
    }

    return deck;
}

// =====================================================
// SECURE RANDOM SHUFFLE
// =====================================================

function shuffle(deck) {

    for (let i = deck.length - 1; i > 0; i--) {

        const j = crypto.randomInt(0, i + 1);

        const temp = deck[i];
        deck[i] = deck[j];
        deck[j] = temp;
    }

    return deck;
}

// =====================================================
// GENERATE 9 CARDS
// =====================================================

function generateNineCards() {

    const deck = createDeck();

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

    res.json({
        ok: true,
        server: "Teen Patti Server",
        status: "running"
    });

});

// =====================================================
// START NEW ROUND
// =====================================================

app.post("/start-round", async (req, res) => {

    try {

        // Optional protection
        const secret = process.env.ADMIN_SECRET;

        if (secret) {

            const suppliedSecret =
                req.headers["x-admin-secret"];

            if (suppliedSecret !== secret) {

                return res.status(401).json({
                    ok: false,
                    error: "Unauthorized"
                });

            }
        }

        // Get current round
        const snapshot = await roundRef.once("value");

        const current = snapshot.val() || {};

        let oldRoundId = Number(current.round_id || 0);

        if (!Number.isFinite(oldRoundId)) {
            oldRoundId = 0;
        }

        const newRoundId = oldRoundId + 1;

        // Generate cards on SERVER
        const cards = generateNineCards();

        const now = Date.now();

        // 10 second waiting period
        const revealAt = now + 10000;

        // Write complete round
        await roundRef.set({

            round_id: String(newRoundId),

            status: "waiting",

            started_at: now,

            reveal_at: revealAt,

            cards: cards

        });

        console.log(
            `Round ${newRoundId} created`
        );

        console.log(cards);

        // After 10 seconds reveal
        setTimeout(async () => {

            try {

                const latest =
                    await roundRef.once("value");

                const latestData =
                    latest.val();

                if (
                    latestData &&
                    String(latestData.round_id) ===
                    String(newRoundId)
                ) {

                    await roundRef.update({
                        status: "reveal",
                        revealed_at: Date.now()
                    });

                    console.log(
                        `Round ${newRoundId} revealed`
                    );
                }

            } catch (error) {

                console.error(
                    "Reveal error:",
                    error
                );

            }

        }, 10000);

        res.json({

            ok: true,

            round_id: String(newRoundId),

            status: "waiting",

            reveal_at: revealAt,

            cards: cards

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            ok: false,

            error: error.message

        });

    }

});

// =====================================================
// SERVER
// =====================================================

app.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Teen Patti Server running on port ${PORT}`
    );

});
