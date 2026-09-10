const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");

const app = express();

app.use(express.json());

// =====================================================
// SERVER CONFIG
// =====================================================

const PORT =
    process.env.PORT || 10000;

const ROOM_ID =
    "567943";

// 20 seconds selection time
const WAITING_TIME =
    20 * 1000;

// 10 seconds cards visible
const REVEAL_TIME =
    10 * 1000;

// Reconcile every second
const RECONCILE_INTERVAL =
    1000;

// Firebase Admin SDK service account
const SERVICE_ACCOUNT_PATH =
    "/etc/secrets/firebase-service-account.json";

// =====================================================
// ENV CHECK
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
// SERVICE ACCOUNT
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
// DATABASE
// =====================================================

const db =
    admin.database();

const teenPattiRef =
    db
        .ref("rooms")
        .child(ROOM_ID)
        .child("teen_patti");

const roundRef =
    teenPattiRef
        .child("round");

const betRequestsRef =
    teenPattiRef
        .child("betRequests");

const serverRoundRef =
    teenPattiRef
        .child("server_round");

const roundUsersRef =
    teenPattiRef
        .child("round_users");

// =====================================================
// LOCKS
// =====================================================

let roundOperationRunning =
    false;

let reconcileRunning =
    false;

// =====================================================
// ALLOWED AMOUNTS
// =====================================================

const ALLOWED_AMOUNTS = [

    10,
    100,
    1000,
    10000,
    100000

];

// =====================================================
// ALLOWED SEATS
// =====================================================

const ALLOWED_SEATS = [

    "A",
    "B",
    "C"

];

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
// CARD VALUES
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
// TRAIL
// =====================================================

function isTrail(values) {

    return (

        values[0] === values[1] &&
        values[1] === values[2]

    );
}

// =====================================================
// COLOR
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
// SEQUENCE
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
// PAIR
// =====================================================

function getPairInfo(values) {

    if (

        values[0] ===
        values[1]

    ) {

        return {

            pair:
                values[0],

            kicker:
                values[2]

        };
    }

    if (

        values[1] ===
        values[2]

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
// CALCULATE ROUND RESULTS
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

    // -------------------------------------------------
    // CHECK B
    // -------------------------------------------------

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

    // -------------------------------------------------
    // CHECK C
    // -------------------------------------------------

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
    // TIE
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

    if (
        tiedPlayers.length > 1
    ) {

        winner =
            tiedPlayers.join(",");
    }

    return {

        A: {

            category:
                handA.category,

            category_rank:
                handA.category_rank

        },

        B: {

            category:
                handB.category,

            category_rank:
                handB.category_rank

        },

        C: {

            category:
                handC.category,

            category_rank:
                handC.category_rank

        },

        winner:
            winner

    };
}

// =====================================================
// REQUEST STATUS
// =====================================================

async function setRequestStatus(
    requestId,
    status,
    extra = {}
) {

    const updateData = {

        status:
            status,

        processed_at:
            Date.now(),

        ...extra

    };

    await betRequestsRef
        .child(requestId)
        .update(updateData);
}

// =====================================================
// RESET USERS FROM PREVIOUS ROUND
// =====================================================
//
// Sirf un users ko reset karta hai jinhone previous
// round mein selection ki thi.
//
// Isse Java ka:
//
// You:400170
//
// next round mein:
//
// You:0
//
// ho jayega.
//

async function resetPreviousRoundUsers(
    previousRoundId
) {

    if (
        !previousRoundId ||
        previousRoundId === "0"
    ) {

        return;
    }

    try {

        const snapshot =
            await roundUsersRef
                .child(previousRoundId)
                .once("value");

        if (!snapshot.exists()) {

            return;
        }

        const updates = {};

        snapshot.forEach(
            child => {

                const uid =
                    child.key;

                if (!uid) return;

                updates[
                    `users/${uid}/demand/seatA`
                ] = 0;

                updates[
                    `users/${uid}/demand/seatB`
                ] = 0;

                updates[
                    `users/${uid}/demand/seatC`
                ] = 0;

            }
        );

        if (
            Object.keys(updates).length === 0
        ) {

            return;
        }

        await db.ref().update(
            updates
        );

        console.log(
            "PREVIOUS ROUND USER DEMAND RESET:",
            previousRoundId
        );

    } catch (error) {

        console.error(
            "RESET PREVIOUS DEMAND ERROR:",
            error
        );
    }
}

// =====================================================
// PROCESS SELECTION
// =====================================================

async function processSelectionRequest(
    requestId,
    request
) {

    if (!request) {

        return;
    }

    // -------------------------------------------------
    // ALREADY PROCESSED
    // -------------------------------------------------

    if (

        request.status === "accepted" ||

        request.status === "rejected"

    ) {

        return;
    }

    const uid =
        String(
            request.uid || ""
        ).trim();

    const requestRoundId =
        String(
            request.round_id || ""
        ).trim();



let seat =
    String(
        request.seat || ""
    )
        .trim()
        .toUpperCase();

// Java agar seatA/seatB/seatC bheje
// to server A/B/C mein convert karega.
if (seat === "SEATA") {
    seat = "A";
}

if (seat === "SEATB") {
    seat = "B";
}

if (seat === "SEATC") {
    seat = "C";
}
    

    const amount =
        Number(
            request.amount
        );

    // -------------------------------------------------
    // UID
    // -------------------------------------------------

    if (!uid) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Missing UID"
            }

        );

        return;
    }

    // -------------------------------------------------
    // ROUND ID
    // -------------------------------------------------

    if (!requestRoundId) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Missing round_id"
            }

        );

        return;
    }

    // -------------------------------------------------
    // SEAT
    // -------------------------------------------------

    if (
        !ALLOWED_SEATS.includes(
            seat
        )
    ) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Invalid seat"
            }

        );

        return;
    }

    // -------------------------------------------------
    // AMOUNT
    // -------------------------------------------------

    if (
        !ALLOWED_AMOUNTS.includes(
            amount
        )
    ) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Invalid amount"
            }

        );

        return;
    }

    // -------------------------------------------------
    // CURRENT ROUND
    // -------------------------------------------------

    const roundSnapshot =
        await roundRef.once(
            "value"
        );

    const round =
        roundSnapshot.val();

    if (!round) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "No active round"
            }

        );

        return;
    }

    const currentRoundId =
        String(
            round.round_id || ""
        );

    // -------------------------------------------------
    // ROUND MATCH
    // -------------------------------------------------

    if (
        currentRoundId !==
        requestRoundId
    ) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Round expired"
            }

        );

        return;
    }

    // -------------------------------------------------
    // ONLY WAITING
    // -------------------------------------------------

    if (
        round.status !==
        "waiting"
    ) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Selection closed"
            }

        );

        return;
    }

    // -------------------------------------------------
    // REQUEST CLAIM
    // -------------------------------------------------

    const requestRef =
        betRequestsRef
            .child(requestId);

    let claimed =
        false;

    const claimResult =
        await requestRef.transaction(

            current => {

                if (!current) {

                    return;
                }

                if (

                    current.status ===
                    "accepted" ||

                    current.status ===
                    "rejected" ||

                    current.status ===
                    "processing"

                ) {

                    return;
                }

                current.status =
                    "processing";

                current.processing_at =
                    Date.now();

                claimed =
                    true;

                return current;
            }

        );

    if (
        !claimResult.committed
    ) {

        return;
    }

    if (!claimed) {

        return;
    }

    // -------------------------------------------------
    // USER REFERENCE
    // -------------------------------------------------

    const userRef =
        db.ref(
            `users/${uid}`
        );

    let transactionResult;

    try {

        transactionResult =
            await userRef.transaction(

                currentUser => {

                    if (
                        currentUser === null
                    ) {

                        return;
                    }

                    // ---------------------------------
                    // DUPLICATE REQUEST
                    // ---------------------------------

                    if (

                        currentUser
                            .processedSelectionRequests &&

                        currentUser
                            .processedSelectionRequests[
                                requestId
                            ]

                    ) {

                        return currentUser;
                    }

                    const diamonds =
                        Number(
                            currentUser.diamonds || 0
                        );

                    if (
                        !Number.isFinite(
                            diamonds
                        )
                    ) {

                        return;
                    }

                    // ---------------------------------
                    // BALANCE CHECK
                    // ---------------------------------

                    if (
                        diamonds < amount
                    ) {

                        return;
                    }

                    // ---------------------------------
                    // DEDUCT VIRTUAL DIAMONDS
                    // ---------------------------------

                    currentUser.diamonds =
                        diamonds - amount;

                    // ---------------------------------
                    // DEMAND OBJECT
                    // ---------------------------------

                    if (

                        !currentUser.demand ||

                        typeof currentUser.demand !==
                        "object"

                    ) {

                        currentUser.demand = {};
                    }

                    // ---------------------------------
                    // CURRENT DEMAND
                    // ---------------------------------

                    const demandKey =
                        `seat${seat}`;

                    const oldDemand =
                        Number(

                            currentUser
                                .demand[
                                    demandKey
                                ] || 0

                        );

                    currentUser
                        .demand[
                            demandKey
                        ] =
                            oldDemand + amount;

                    // ---------------------------------
                    // REQUEST MARKER
                    // ---------------------------------

                    if (

                        !currentUser
                            .processedSelectionRequests

                    ) {

                        currentUser
                            .processedSelectionRequests = {};
                    }

                    currentUser
                        .processedSelectionRequests[
                            requestId
                        ] = true;

                    return currentUser;
                }

            );

    } catch (error) {

        console.error(
            "USER TRANSACTION ERROR:",
            error
        );

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "User transaction error"
            }

        );

        return;
    }

    // -------------------------------------------------
    // BALANCE FAILED
    // -------------------------------------------------

    if (
        !transactionResult.committed
    ) {

        await setRequestStatus(

            requestId,

            "rejected",

            {
                reason:
                    "Insufficient diamonds or user unavailable"
            }

        );

        return;
    }

    // -------------------------------------------------
    // UPDATE POT
    // -------------------------------------------------

    const potRef =
        roundRef
            .child("pot")
            .child(seat);

    try {

        const potResult =
            await potRef.transaction(

                currentPot => {

                    const oldPot =
                        Number(
                            currentPot || 0
                        );

                    return oldPot + amount;
                }

            );

        if (
            !potResult.committed
        ) {

            console.error(
                "POT TRANSACTION FAILED"
            );

            await setRequestStatus(

                requestId,

                "accepted_pot_update_error",

                {
                    reason:
                        "User updated but pot update failed"
                }

            );

            return;
        }

    } catch (error) {

        console.error(
            "POT ERROR:",
            error
        );

        await setRequestStatus(

            requestId,

            "accepted_pot_update_error",

            {
                reason:
                    "User updated but pot update failed"
            }

        );

        return;
    }

    // -------------------------------------------------
    // MARK USER AS ROUND PARTICIPANT
    // -------------------------------------------------

    try {

        await roundUsersRef
            .child(currentRoundId)
            .child(uid)
            .set(true);

    } catch (error) {

        console.error(
            "ROUND USER MARK ERROR:",
            error
        );
    }

    // -------------------------------------------------
    // ACCEPT REQUEST
    // -------------------------------------------------

    await setRequestStatus(

        requestId,

        "accepted",

        {

            processed_uid:
                uid,

            processed_round_id:
                currentRoundId,

            processed_seat:
                seat,

            processed_amount:
                amount

        }

    );

    console.log(
        "========================================"
    );

    console.log(
        "SELECTION ACCEPTED"
    );

    console.log(
        "REQUEST:",
        requestId
    );

    console.log(
        "UID:",
        uid
    );

    console.log(
        "ROUND:",
        currentRoundId
    );

    console.log(
        "SEAT:",
        seat
    );

    console.log(
        "AMOUNT:",
        amount
    );

    console.log(
        "========================================"
    );
}

// =====================================================
// BET REQUEST LISTENER
// =====================================================

betRequestsRef.on(

    "child_added",

    async snapshot => {

        const requestId =
            snapshot.key;

        const request =
            snapshot.val();

        if (!requestId) {

            return;
        }

        try {

            console.log(
                "NEW SELECTION REQUEST:",
                requestId
            );

            await processSelectionRequest(

                requestId,

                request

            );

        } catch (error) {

            console.error(
                "REQUEST PROCESS ERROR:",
                error
            );
        }
    }

);

console.log(
    "SELECTION REQUEST PROCESSOR ENABLED"
);

// =====================================================
// CREATE NEW ROUND
// =====================================================

async function createNewRound(
    reason
) {

    if (
        roundOperationRunning
    ) {

        console.log(
            "CREATE ROUND: already running"
        );

        return null;
    }

    roundOperationRunning =
        true;

    try {

        // ---------------------------------------------
        // READ OLD ROUND
        // ---------------------------------------------

        const snapshot =
            await roundRef.once(
                "value"
            );

        const current =
            snapshot.val() || {};

        const oldRoundId =
            String(
                current.round_id || "0"
            );

        let oldNumber =
            Number(oldRoundId);

        if (
            !Number.isFinite(
                oldNumber
            )
        ) {

            oldNumber =
                0;
        }

        const newRoundId =
            String(
                oldNumber + 1
            );

        // ---------------------------------------------
        // RESET PREVIOUS USERS
        // ---------------------------------------------

        await resetPreviousRoundUsers(
            oldRoundId
        );

        // ---------------------------------------------
        // GENERATE CARDS
        // ---------------------------------------------

        const cards =
            generateNineCards();

        // ---------------------------------------------
        // CALCULATE RESULTS
        // ---------------------------------------------

        const results =
            calculateRoundResults(
                cards
            );

        const now =
            Date.now();

        const revealAt =
            now +
            WAITING_TIME;

        // ---------------------------------------------
        // PUBLIC ROUND
        // ---------------------------------------------

        const roundData = {

            round_id:
                newRoundId,

            status:
                "waiting",

            started_at:
                now,

            reveal_at:
                revealAt,

            pot: {

                A: 0,

                B: 0,

                C: 0

            },

            cards:
                null,

            results:
                null,

            winner:
                null

        };

        // ---------------------------------------------
        // PRIVATE SERVER ROUND
        // ---------------------------------------------

        const privateRound = {

            round_id:
                newRoundId,

            cards:
                cards,

            results:
                results,

            created_at:
                now

        };

        // ---------------------------------------------
        // WRITE BOTH
        // ---------------------------------------------

        await roundRef.set(
            roundData
        );

        await serverRoundRef.set(
            privateRound
        );

        console.log(
            "========================================"
        );

        console.log(
            "NEW ROUND CREATED"
        );

        console.log(
            "ROUND:",
            newRoundId
        );

        console.log(
            "REASON:",
            reason || "normal"
        );

        console.log(
            "STATUS:",
            "waiting"
        );

        console.log(
            "WAITING:",
            "20 seconds"
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
            "========================================"
        );

        // ---------------------------------------------
        // SCHEDULE
        // ---------------------------------------------

        scheduleReveal(

            newRoundId,

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

        roundOperationRunning =
            false;
    }
}

// =====================================================
// REVEAL ROUND
// =====================================================

async function revealRound(
    roundId
) {

    try {

        const snapshot =
            await roundRef.once(
                "value"
            );

        const latest =
            snapshot.val();

        if (
            !latest
        ) {

            return false;
        }

        if (

            String(
                latest.round_id
            ) !==
            String(roundId)

        ) {

            return false;
        }

        if (
            latest.status !==
            "waiting"
        ) {

            return false;
        }

        // ---------------------------------------------
        // PRIVATE SERVER DATA
        // ---------------------------------------------

        const privateSnapshot =
            await serverRoundRef.once(
                "value"
            );

        const privateRound =
            privateSnapshot.val();

        if (
            !privateRound
        ) {

            console.error(
                "PRIVATE SERVER ROUND NOT FOUND"
            );

            return false;
        }

        if (

            String(
                privateRound.round_id
            ) !==
            String(roundId)

        ) {

            console.error(
                "PRIVATE ROUND ID MISMATCH"
            );

            return false;
        }

        const revealedAt =
            Date.now();

        // ---------------------------------------------
        // PUBLISH RESULT
        // ---------------------------------------------

        await roundRef.update({

            status:
                "reveal",

            revealed_at:
                revealedAt,

            cards:
                privateRound.cards,

            results:
                privateRound.results,

            winner:
                privateRound.results.winner

        });

        console.log(
            "========================================"
        );

        console.log(
            "ROUND REVEALED:",
            roundId
        );

        console.log(
            "CARDS PUBLISHED"
        );

        console.log(
            "RESULTS PUBLISHED"
        );

        console.log(
            "WINNER:",
            privateRound.results.winner
        );

        console.log(
            "========================================"
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

            Number(
                revealAt
            ) -
            Date.now()

        );

    console.log(
        `ROUND ${roundId} REVEAL IN ${delay} ms`
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
// NEXT ROUND
// =====================================================

function scheduleNextRoundAfterReveal(
    roundId,
    revealedAt
) {

    const nextRoundAt =
        Number(
            revealedAt
        ) +
        REVEAL_TIME;

    const delay =
        Math.max(

            0,

            nextRoundAt -
            Date.now()

        );

    console.log(
        `NEXT ROUND ${delay} ms`
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
                    !latest
                ) {

                    await createNewRound(
                        "next round missing"
                    );

                    return;
                }

                if (

                    String(
                        latest.round_id
                    ) !==
                    String(roundId)

                ) {

                    return;
                }

                if (
                    latest.status !==
                    "reveal"
                ) {

                    return;
                }

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

async function reconcileRound() {

    if (
        reconcileRunning
    ) {

        return;
    }

    reconcileRunning =
        true;

    try {

        const snapshot =
            await roundRef.once(
                "value"
            );

        const round =
            snapshot.val();

        // ---------------------------------------------
        // NO ROUND
        // ---------------------------------------------

        if (!round) {

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

        // ---------------------------------------------
        // WAITING
        // ---------------------------------------------

        if (
            status === "waiting"
        ) {

            if (
                revealAt <= 0
            ) {

                await createNewRound(
                    "invalid reveal time"
                );

                return;
            }

            if (
                now >= revealAt
            ) {

                await revealRound(
                    roundId
                );

            }

            return;
        }

        // ---------------------------------------------
        // REVEAL
        // ---------------------------------------------

        if (
            status === "reveal"
        ) {

            let revealedAt =
                Number(
                    round.revealed_at || 0
                );

            if (
                revealedAt <= 0
            ) {

                revealedAt =
                    now;

                await roundRef.update({

                    revealed_at:
                        revealedAt

                });

                return;
            }

            const nextRoundAt =
                revealedAt +
                REVEAL_TIME;

            if (
                now >= nextRoundAt
            ) {

                await createNewRound(
                    "reconcile reveal finished"
                );

            }

            return;
        }

        // ---------------------------------------------
        // UNKNOWN
        // ---------------------------------------------

        console.log(
            "UNKNOWN ROUND STATUS:",
            status
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

        reconcileRunning =
            false;
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

        // ---------------------------------------------
        // NO ROUND
        // ---------------------------------------------

        if (!round) {

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
            "STARTUP RECOVERY"
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
            "NOW:",
            now
        );

        console.log(
            "REVEAL AT:",
            revealAt
        );

        console.log(
            "========================================"
        );

        // ---------------------------------------------
        // WAITING ACTIVE
        // ---------------------------------------------

        if (

            status === "waiting" &&

            revealAt > now

        ) {

            scheduleReveal(

                roundId,

                revealAt

            );

            return;
        }

        // ---------------------------------------------
        // WAITING EXPIRED
        // ---------------------------------------------

        if (

            status === "waiting" &&

            revealAt <= now

        ) {

            await revealRound(
                roundId
            );

            return;
        }

        // ---------------------------------------------
        // REVEAL
        // ---------------------------------------------

        if (
            status === "reveal"
        ) {

            let revealedAt =
                Number(
                    round.revealed_at || 0
                );

            if (
                revealedAt <= 0
            ) {

                revealedAt =
                    now;

                await roundRef.update({

                    revealed_at:
                        revealedAt

                });

            }

            const revealEnd =
                revealedAt +
                REVEAL_TIME;

            if (
                revealEnd > now
            ) {

                scheduleNextRoundAfterReveal(

                    roundId,

                    revealedAt

                );

                return;
            }

            await createNewRound(
                "startup reveal expired"
            );

            return;
        }

        // ---------------------------------------------
        // UNKNOWN
        // ---------------------------------------------

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
// HEALTH
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.status(200).json({

            ok:
                true,

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

            selection_processor:
                "enabled",

            reconciler:
                "enabled",

            startup_recovery:
                "enabled"

        });
    }
);

// =====================================================
// HEALTH DETAIL
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

                ok:
                    true,

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

                reveal_at:
                    round
                        ? round.reveal_at
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

                ok:
                    false,

                error:
                    error.message

            });
        }
    }
);

// =====================================================
// GET ROUND
// =====================================================

app.get(
    "/round",
    async (req, res) => {

        try {

            const snapshot =
                await roundRef.once(
                    "value"
                );

            const round =
                snapshot.val();

            if (!round) {

                return res.status(
                    404
                ).json({

                    ok:
                        false,

                    error:
                        "No round found"

                });
            }

            res.status(200).json({

                ok:
                    true,

                room_id:
                    ROOM_ID,

                round:
                    round

            });

        } catch (error) {

            console.error(
                "GET ROUND ERROR:",
                error
            );

            res.status(500).json({

                ok:
                    false,

                error:
                    error.message

            });
        }
    }
);

// =====================================================
// ADMIN START ROUND
// =====================================================

app.post(
    "/start-round",
    async (req, res) => {

        try {

            const suppliedSecret =
                req.headers[
                    "x-admin-secret"
                ];

            if (

                !suppliedSecret ||

                suppliedSecret !==
                process.env.ADMIN_SECRET

            ) {

                return res.status(
                    401
                ).json({

                    ok:
                        false,

                    error:
                        "Unauthorized"

                });
            }

            const result =
                await createNewRound(
                    "admin start"
                );

            if (!result) {

                return res.status(
                    409
                ).json({

                    ok:
                        false,

                    error:
                        "Round operation already running"

                });
            }

            res.status(200).json({

                ok:
                    true,

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

                ok:
                    false,

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

        res.status(
            404
        ).json({

            ok:
                false,

            error:
                "Endpoint not found"

        });
    }
);

// =====================================================
// GLOBAL ERROR
// =====================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "EXPRESS ERROR:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(error);
        }

        res.status(
            500
        ).json({

            ok:
                false,

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
                "========================================"
            );

            console.log(
                "PORT:",
                PORT
            );

            console.log(
                "ROOM:",
                ROOM_ID
            );

            console.log(
                "FIREBASE ADMIN: CONNECTED"
            );

            console.log(
                "WAITING:",
                "20 SECONDS"
            );

            console.log(
                "REVEAL:",
                "10 SECONDS"
            );

            console.log(
                "SERVER CARDS: ENABLED"
            );

            console.log(
                "SERVER WINNER: ENABLED"
            );

            console.log(
                "SELECTION PROCESSOR: ENABLED"
            );

            console.log(
                "POT UPDATE: ENABLED"
            );

            console.log(
                "DEMAND UPDATE: ENABLED"
            );

            console.log(
                "NEXT ROUND DEMAND RESET: ENABLED"
            );

            console.log(
                "RECONCILER: ENABLED"
            );

            console.log(
                "STARTUP RECOVERY: ENABLED"
            );

            console.log(
                "========================================"
            );

            try {

                await resumeExistingRound();

            } catch (error) {

                console.error(
                    "STARTUP ERROR:",
                    error
                );
            }

            // -----------------------------------------
            // RECONCILER
            // -----------------------------------------

            setInterval(

                () => {

                    reconcileRound()
                        .catch(error => {

                            console.error(
                                "RECONCILER ERROR:",
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

async function shutdown(
    signal
) {

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

// =====================================================
// SIGNALS
// =====================================================

process.on(
    "SIGTERM",
    () =>
        shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () =>
        shutdown("SIGINT")
);
