const express = require("express");
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const ROOM_ID = "567943";

const WAITING_TIME = 20 * 1000;
const REVEAL_TIME = 10 * 1000;
const RECONCILE_INTERVAL = 1000;

// =========================================================
// RANDOM POT DISPLAY
// Display-only number. It is NOT actual demand and does
// NOT affect cards, winner, diamonds, or payout.
// =========================================================
const POT_MIN = 10000;
const POT_MAX = 99999;

const SERVICE_ACCOUNT_PATH =
  "/etc/secrets/firebase-service-account.json";

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

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  throw new Error(
    "Firebase service account file is missing: " +
    SERVICE_ACCOUNT_PATH
  );
}

const serviceAccount = JSON.parse(
  fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

const teenPattiRef =
  db.ref(`rooms/${ROOM_ID}/teen_patti`);

const roundRef =
  teenPattiRef.child("round");

const betRequestsRef =
  teenPattiRef.child("betRequests");

const serverRoundRef =
  teenPattiRef.child("server_round");

const roundUsersRef =
  teenPattiRef.child("round_users");

const ALLOWED_AMOUNTS = [
  10,
  100,
  1000,
  10000,
  100000
];

const ALLOWED_SEATS = ["A", "B", "C"];

const suits = ["♠", "♥", "♦", "♣"];

const ranks = [
  "A", "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "J", "Q", "K"
];

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

let roundOperationRunning = false;
let reconcileRunning = false;

let potDisplayTimer = null;
let potDisplayRoundId = null;

/* =========================================================
   RANDOM POT DISPLAY
   Path:
   rooms/ROOM_ID/teen_patti/round/pot_display
   This matches Java reading round/pot_display.
   ========================================================= */

function randomPotNumber() {
  return crypto.randomInt(
    POT_MIN,
    POT_MAX + 1
  );
}

function makeRandomPotDisplay() {
  return {
    A: randomPotNumber(),
    B: randomPotNumber(),
    C: randomPotNumber(),
    updated_at: Date.now()
  };
}

async function updatePotDisplay(roundId) {
  if (!roundId) return;

  try {
    const snap =
      await roundRef.once("value");

    const round =
      snap.val();

    if (!round) return;

    if (
      String(round.round_id || "") !==
      String(roundId)
    ) {
      return;
    }

    if (
      String(round.status || "").toLowerCase() !==
      "waiting"
    ) {
      return;
    }

    await roundRef
      .child("pot_display")
      .set(makeRandomPotDisplay());

  } catch (e) {
    console.error(
      "POT DISPLAY UPDATE ERROR",
      e
    );
  }
}

function startPotDisplay(roundId) {
  stopPotDisplay();

  potDisplayRoundId =
    String(roundId);

  updatePotDisplay(
    potDisplayRoundId
  ).catch((e) => {
    console.error(
      "INITIAL POT DISPLAY ERROR",
      e
    );
  });

  potDisplayTimer =
    setInterval(() => {
      updatePotDisplay(
        potDisplayRoundId
      ).catch((e) => {
        console.error(
          "POT DISPLAY TIMER ERROR",
          e
        );
      });
    }, 1000);

  console.log(
    "POT DISPLAY STARTED",
    {
      roundId: potDisplayRoundId,
      intervalMs: 1000
    }
  );
}

function stopPotDisplay() {
  if (potDisplayTimer) {
    clearInterval(
      potDisplayTimer
    );

    potDisplayTimer = null;
  }

  potDisplayRoundId = null;
}

/* =========================================================
   CARDS
   ========================================================= */

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

    [
      deck[i],
      deck[j]
    ] = [
      deck[j],
      deck[i]
    ];
  }

  return deck;
}

function generateNineCards() {
  const deck =
    shuffle(
      createDeck()
    );

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

function parseCard(card) {
  const p =
    String(card).split("|");

  return {
    rank: p[0],
    suit: p[1]
  };
}

function getCardValues(cards) {
  return cards
    .map(
      (c) =>
        rankValues[
          parseCard(c).rank
        ]
    )
    .sort(
      (a, b) => b - a
    );
}

function isTrail(v) {
  return (
    v[0] === v[1] &&
    v[1] === v[2]
  );
}

function isColor(cards) {
  const p =
    cards.map(parseCard);

  return (
    p[0].suit === p[1].suit &&
    p[1].suit === p[2].suit
  );
}

function getSequenceHigh(values) {
  const v =
    [...values].sort(
      (a, b) => a - b
    );

  if (
    v[0] === 2 &&
    v[1] === 3 &&
    v[2] === 14
  ) {
    return 3;
  }

  if (
    v[1] === v[0] + 1 &&
    v[2] === v[1] + 1
  ) {
    return v[2];
  }

  return null;
}

function getPairInfo(v) {
  if (
    v[0] === v[1]
  ) {
    return {
      pair: v[0],
      kicker: v[2]
    };
  }

  if (
    v[1] === v[2]
  ) {
    return {
      pair: v[1],
      kicker: v[0]
    };
  }

  return null;
}

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

  if (trail) {
    return {
      category: "Trail",
      category_rank: 6,
      compare: [values[0]]
    };
  }

  if (
    color &&
    sequenceHigh !== null
  ) {
    return {
      category: "Pure Sequence",
      category_rank: 5,
      compare: [sequenceHigh]
    };
  }

  if (
    sequenceHigh !== null
  ) {
    return {
      category: "Sequence",
      category_rank: 4,
      compare: [sequenceHigh]
    };
  }

  if (color) {
    return {
      category: "Color",
      category_rank: 3,
      compare: values
    };
  }

  if (pair) {
    return {
      category: "Pair",
      category_rank: 2,
      compare: [
        pair.pair,
        pair.kicker
      ]
    };
  }

  return {
    category: "High Card",
    category_rank: 1,
    compare: values
  };
}

function compareHands(a, b) {
  if (
    a.category_rank !==
    b.category_rank
  ) {
    return (
      a.category_rank -
      b.category_rank
    );
  }

  const ac =
    a.compare || [];

  const bc =
    b.compare || [];

  const len =
    Math.max(
      ac.length,
      bc.length
    );

  for (
    let i = 0;
    i < len;
    i++
  ) {
    const x =
      ac[i] || 0;

    const y =
      bc[i] || 0;

    if (x !== y) {
      return x - y;
    }
  }

  return 0;
}

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

  let best =
    handA;

  let winner =
    "A";

  if (
    compareHands(
      handB,
      best
    ) > 0
  ) {
    best = handB;
    winner = "B";
  }

  if (
    compareHands(
      handC,
      best
    ) > 0
  ) {
    best = handC;
    winner = "C";
  }

  const tied = [];

  if (
    compareHands(
      handA,
      best
    ) === 0
  ) {
    tied.push("A");
  }

  if (
    compareHands(
      handB,
      best
    ) === 0
  ) {
    tied.push("B");
  }

  if (
    compareHands(
      handC,
      best
    ) === 0
  ) {
    tied.push("C");
  }

  if (tied.length > 1) {
    winner =
      tied.join(",");
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

    winner
  };
}

/* =========================================================
   PROFILE HELPERS
   ========================================================= */

function getProfileValue(
  user,
  keys
) {
  if (
    !user ||
    typeof user !== "object"
  ) {
    return "";
  }

  for (const key of keys) {
    const value =
      user[key];

    if (
      value !== undefined &&
      value !== null
    ) {
      const s =
        String(value).trim();

      if (s) {
        return s;
      }
    }
  }

  return "";
}

const NAME_KEYS = [
  "name",
  "displayName",
  "display_name",
  "username",
  "userName",
  "user_name",
  "nickName",
  "nickname"
];

const PHOTO_KEYS = [
  "photoUrl",
  "photoURL",
  "photo_url",
  "photo",
  "profilePhoto",
  "profile_photo",
  "profile_image",
  "profileImage",
  "avatarUrl",
  "avatarURL",
  "avatar",
  "imageUrl",
  "imageURL",
  "image",
  "profilePic",
  "profile_pic",
  "profilePicture",
  "profile_picture",
  "picture",
  "headUrl",
  "headURL",
  "portrait",
  "icon"
];

async function getUserProfile(
  uid
) {
  let profile = {};

  try {
    const snap =
      await db
        .ref(`users/${uid}`)
        .once("value");

    profile =
      snap.val() || {};
  } catch (e) {
    console.error(
      "PROFILE READ ERROR",
      uid,
      e
    );
  }

  let name =
    getProfileValue(
      profile,
      NAME_KEYS
    );

  let photoUrl =
    getProfileValue(
      profile,
      PHOTO_KEYS
    );

  // Firebase Auth fallback.
  if (!name || !photoUrl) {
    try {
      const authUser =
        await admin
          .auth()
          .getUser(uid);

      if (
        !name &&
        authUser.displayName
      ) {
        name =
          String(
            authUser.displayName
          ).trim();
      }

      if (
        !photoUrl &&
        authUser.photoURL
      ) {
        photoUrl =
          String(
            authUser.photoURL
          ).trim();
      }
    } catch (e) {
      console.error(
        "AUTH PROFILE FALLBACK ERROR",
        uid,
        e
      );
    }
  }

  return {
    name:
      name || "User",

    photo_url:
      photoUrl || ""
  };
}

/* =========================================================
   TOP 3 CURRENT-ROUND DEMAND
   ---------------------------------------------------------
   This is display-only.
   It does NOT decide winner/cards/payout.

   Important:
   - Top 3 is reset with every new round.
   - Current round only.
   - Outside user replaces #3 only with STRICTLY higher
     total demand.
   - Existing top-3 user's increased demand can reorder.
   - Name/photo are stored with the UID.
   ========================================================= */

async function updateTop3Demand(
  roundId
) {
  if (!roundId) {
    return null;
  }

  try {
    const usersSnap =
      await roundUsersRef
        .child(roundId)
        .once("value");

    const usersData =
      usersSnap.val() || {};

    const entriesByUid =
      new Map();

    for (
      const [uid, demand]
      of Object.entries(
        usersData
      )
    ) {
      if (
        !demand ||
        typeof demand !==
          "object"
      ) {
        continue;
      }

      const rawA =
        Number(
          demand.seatA || 0
        );

      const rawB =
        Number(
          demand.seatB || 0
        );

      const rawC =
        Number(
          demand.seatC || 0
        );

      const seatA =
        Number.isSafeInteger(rawA) &&
        rawA >= 0
          ? rawA
          : 0;

      const seatB =
        Number.isSafeInteger(rawB) &&
        rawB >= 0
          ? rawB
          : 0;

      const seatC =
        Number.isSafeInteger(rawC) &&
        rawC >= 0
          ? rawC
          : 0;

      const total =
        seatA +
        seatB +
        seatC;

      if (
        !Number.isSafeInteger(
          total
        ) ||
        total <= 0
      ) {
        continue;
      }

      entriesByUid.set(
        String(uid),
        {
          uid: String(uid),
          total_demand: total,
          seatA,
          seatB,
          seatC
        }
      );
    }

    // Existing order.
    const previousSnap =
      await roundRef
        .child("top3")
        .once("value");

    const previous =
      previousSnap.val() || {};

    const previousOrder =
      [];

    for (
      const rank of [
        "1",
        "2",
        "3"
      ]
    ) {
      const item =
        previous[rank];

      if (
        !item ||
        !item.uid
      ) {
        continue;
      }

      const uid =
        String(item.uid);

      if (
        entriesByUid.has(uid) &&
        !previousOrder.includes(
          uid
        )
      ) {
        previousOrder.push(
          uid
        );
      }
    }

    let selectedUids =
      previousOrder.slice(
        0,
        3
      );

    // Fill empty places.
    if (
      selectedUids.length < 3
    ) {
      const candidates =
        Array.from(
          entriesByUid.values()
        ).filter(
          (item) =>
            !selectedUids.includes(
              item.uid
            )
        );

      candidates.sort(
        (a, b) =>
          b.total_demand -
          a.total_demand
      );

      for (
        const candidate
        of candidates
      ) {
        if (
          selectedUids.length >=
          3
        ) {
          break;
        }

        selectedUids.push(
          candidate.uid
        );
      }
    }

    // If already 3, outside user must be STRICTLY greater
    // than current #3 to enter.
    while (
      selectedUids.length >= 3
    ) {
      const cutoffUid =
        selectedUids[2];

      const cutoff =
        entriesByUid.get(
          cutoffUid
        );

      if (!cutoff) {
        break;
      }

      let bestCandidate =
        null;

      for (
        const candidate
        of entriesByUid.values()
      ) {
        if (
          selectedUids.includes(
            candidate.uid
          )
        ) {
          continue;
        }

        if (
          candidate.total_demand >
          cutoff.total_demand
        ) {
          if (
            bestCandidate ===
              null ||
            candidate.total_demand >
              bestCandidate.total_demand
          ) {
            bestCandidate =
              candidate;
          }
        }
      }

      if (!bestCandidate) {
        break;
      }

      selectedUids[2] =
        bestCandidate.uid;

      selectedUids.sort(
        (uidA, uidB) => {
          const a =
            entriesByUid.get(
              uidA
            );

          const b =
            entriesByUid.get(
              uidB
            );

          if (!a || !b) {
            return 0;
          }

          return (
            b.total_demand -
            a.total_demand
          );
        }
      );
    }

    // Build display data.
    const result = {};

    for (
      let i = 0;
      i < selectedUids.length &&
      i < 3;
      i++
    ) {
      const uid =
        selectedUids[i];

      const item =
        entriesByUid.get(
          uid
        );

      if (!item) {
        continue;
      }

      // Keep previously stored profile if it exists.
      // Only fetch profile when needed, reducing unnecessary
      // Auth/profile reads during repeated demand updates.
      const oldItem =
        previous[
          String(i + 1)
        ];

      let profile = null;

      if (
        oldItem &&
        String(oldItem.uid) ===
          String(uid) &&
        oldItem.name !== undefined &&
        oldItem.photo_url !== undefined
      ) {
        profile = {
          name:
            String(
              oldItem.name || ""
            ).trim() ||
            "User",

          photo_url:
            String(
              oldItem.photo_url ||
                ""
            ).trim()
        };
      } else {
        profile =
          await getUserProfile(
            uid
          );
      }

      result[
        String(i + 1)
      ] = {
        rank: i + 1,
        uid: item.uid,

        name:
          profile.name ||
          "User",

        photo_url:
          profile.photo_url ||
          "",

        total_demand:
          item.total_demand,

        seatA:
          item.seatA,

        seatB:
          item.seatB,

        seatC:
          item.seatC
      };
    }

    // Save Top 3.
    // updated_at changes only when a real accepted demand causes
    // this function to run; it is NOT touched by Pot timer.
    await roundRef
      .child("top3")
      .set({
        1:
          result["1"] ||
          null,

        2:
          result["2"] ||
          null,

        3:
          result["3"] ||
          null,

        updated_at:
          Date.now()
      });

    console.log(
      "TOP 3 UPDATED",
      {
        roundId,
        top3:
          Object.values(
            result
          ).map(
            (x) => ({
              rank: x.rank,
              uid: x.uid,
              name: x.name,
              photo_url:
                x.photo_url,
              total_demand:
                x.total_demand
            })
          )
      }
    );

    return result;

  } catch (e) {
    console.error(
      "TOP 3 UPDATE ERROR",
      e
    );

    return null;
  }
}

/* =========================================================
   REQUEST STATUS
   ========================================================= */

async function setRequestStatus(
  requestId,
  status,
  extra = {}
) {
  await betRequestsRef
    .child(requestId)
    .update({
      status,
      processed_at:
        Date.now(),
      ...extra
    });
}

/* =========================================================
   AUTH
   ========================================================= */

async function verifyRequestUser(
  request
) {
  const idToken =
    String(
      request.idToken || ""
    ).trim();

  if (!idToken) {
    throw new Error(
      "Missing Firebase ID token"
    );
  }

  const decoded =
    await admin
      .auth()
      .verifyIdToken(
        idToken
      );

  const requestUid =
    String(
      request.uid || ""
    ).trim();

  if (!requestUid) {
    throw new Error(
      "Missing UID"
    );
  }

  if (
    !decoded ||
    decoded.uid !==
      requestUid
  ) {
    throw new Error(
      "UID verification failed"
    );
  }

  return decoded.uid;
}

function normalizeSeat(
  value
) {
  let seat =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

  if (
    seat === "SEATA"
  ) {
    seat = "A";
  }

  if (
    seat === "SEATB"
  ) {
    seat = "B";
  }

  if (
    seat === "SEATC"
  ) {
    seat = "C";
  }

  return seat;
}

/* =========================================================
   ROLLBACK
   ========================================================= */

async function rollbackUser(
  uid,
  requestId,
  amount
) {
  const ref =
    db.ref(`users/${uid}`);

  try {
    const result =
      await ref.transaction(
        (user) => {
          if (!user) {
            return user;
          }

          if (
            !user.processedSelectionRequests ||
            !user
              .processedSelectionRequests[
                requestId
              ]
          ) {
            return user;
          }

          user.diamonds =
            Number(
              user.diamonds || 0
            ) + amount;

          delete user
            .processedSelectionRequests[
              requestId
            ];

          return user;
        }
      );

    return result.committed;

  } catch (e) {
    console.error(
      "ROLLBACK USER ERROR",
      e
    );

    return false;
  }
}

async function rollbackPot(
  roundId,
  seat,
  amount
) {
  const ref =
    roundRef
      .child("pot")
      .child(seat);

  try {
    const result =
      await ref.transaction(
        (value) => {
          const current =
            Number(value || 0);

          if (
            !Number.isSafeInteger(
              current
            ) ||
            current < amount
          ) {
            return;
          }

          return (
            current - amount
          );
        }
      );

    return result.committed;

  } catch (e) {
    console.error(
      "ROLLBACK POT ERROR",
      e
    );

    return false;
  }
}

/* =========================================================
   CURRENT ROUND USER DEMAND
   ========================================================= */

async function updateCurrentRoundDemand(
  roundId,
  uid,
  seat,
  amount
) {
  const ref =
    roundUsersRef
      .child(roundId)
      .child(uid);

  const key =
    `seat${seat}`;

  try {
    const result =
      await ref.transaction(
        (current) => {
          current =
            current &&
            typeof current ===
              "object"
              ? current
              : {};

          const oldValue =
            Number(
              current[key] || 0
            );

          if (
            !Number.isSafeInteger(
              oldValue
            )
          ) {
            return;
          }

          current[key] =
            oldValue + amount;

          current.last_update_at =
            Date.now();

          return current;
        }
      );

    return result.committed;

  } catch (e) {
    console.error(
      "ROUND DEMAND UPDATE ERROR",
      e
    );

    return false;
  }
}

/* =========================================================
   SELECTION REQUEST
   ========================================================= */

async function processSelectionRequest(
  requestId,
  request
) {
  if (!request) {
    return;
  }

  if (
    [
      "accepted",
      "rejected",
      "processing",
      "manual_review"
    ].includes(
      request.status
    )
  ) {
    return;
  }

  const requestRef =
    betRequestsRef
      .child(requestId);

  let claimed = false;

  const claim =
    await requestRef.transaction(
      (current) => {
        if (!current) {
          return;
        }

        if (
          [
            "accepted",
            "rejected",
            "processing",
            "manual_review"
          ].includes(
            current.status
          )
        ) {
          return;
        }

        current.status =
          "processing";

        current.processing_at =
          Date.now();

        claimed = true;

        return current;
      }
    );

  if (
    !claim.committed ||
    !claimed
  ) {
    return;
  }

  let uid;

  try {
    uid =
      await verifyRequestUser(
        request
      );
  } catch (e) {
    await setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          e.message
      }
    );

    return;
  }

  // Token is not kept after verification.
  try {
    await requestRef
      .child("idToken")
      .remove();
  } catch (_) {}

  const roundId =
    String(
      request.round_id || ""
    ).trim();

  const seat =
    normalizeSeat(
      request.seat
    );

  const amount =
    Number(
      request.amount
    );

  if (!roundId) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Missing round_id"
      }
    );
  }

  if (
    !ALLOWED_SEATS.includes(
      seat
    )
  ) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Invalid seat"
      }
    );
  }

  if (
    !Number.isSafeInteger(
      amount
    ) ||
    !ALLOWED_AMOUNTS.includes(
      amount
    )
  ) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Invalid chip amount"
      }
    );
  }

  const roundSnap =
    await roundRef.once(
      "value"
    );

  const round =
    roundSnap.val();

  if (!round) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "No active round"
      }
    );
  }

  if (
    String(
      round.round_id || ""
    ) !== roundId
  ) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Round expired"
      }
    );
  }

  if (
    String(
      round.status || ""
    ).toLowerCase() !==
    "waiting"
  ) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Selection closed"
      }
    );
  }

  if (
    Number(
      round.reveal_at || 0
    ) <= Date.now()
  ) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Selection time expired"
      }
    );
  }

  /* =======================================================
     USER DIAMONDS
     ======================================================= */

  const userRef =
    db.ref(`users/${uid}`);

  let userTransaction;

  try {
    userTransaction =
      await userRef.transaction(
        (user) => {
          if (!user) {
            return user;
          }

          if (
            user.processedSelectionRequests &&
            user
              .processedSelectionRequests[
                requestId
              ]
          ) {
            return user;
          }

          const diamonds =
            Number(
              user.diamonds || 0
            );

          if (
            !Number.isSafeInteger(
              diamonds
            ) ||
            diamonds < amount
          ) {
            return;
          }

          user.diamonds =
            diamonds - amount;

          user.processedSelectionRequests =
            user.processedSelectionRequests ||
            {};

          user
            .processedSelectionRequests[
              requestId
            ] = true;

          return user;
        }
      );

  } catch (e) {
    console.error(
      "USER TRANSACTION ERROR",
      e
    );

    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "User transaction error"
      }
    );
  }

  if (
    !userTransaction.committed
  ) {
    return setRequestStatus(
      requestId,
      "rejected",
      {
        reason:
          "Insufficient diamonds"
      }
    );
  }

  /* =======================================================
     ACTUAL DEMAND ACCOUNTING
     =======================================================
     This is NOT displayed as Pot.
     Java displays round/pot_display.
     ======================================================= */

  const actualPotRef =
    roundRef
      .child("pot")
      .child(seat);

  let potUpdated =
    false;

  try {
    const potTx =
      await actualPotRef.transaction(
        (value) => {
          const current =
            Number(value || 0);

          if (
            !Number.isSafeInteger(
              current
            )
          ) {
            return;
          }

          return (
            current + amount
          );
        }
      );

    potUpdated =
      potTx.committed;

  } catch (e) {
    console.error(
      "POT UPDATE ERROR",
      e
    );
  }

  if (!potUpdated) {
    const rollback =
      await rollbackUser(
        uid,
        requestId,
        amount
      );

    return setRequestStatus(
      requestId,
      rollback
        ? "rejected"
        : "manual_review",
      {
        reason:
          rollback
            ? "Pot update failed; balance rolled back"
            : "Pot update failed and rollback failed"
      }
    );
  }

  /* =======================================================
     CURRENT ROUND USER DEMAND
     ======================================================= */

  const demandUpdated =
    await updateCurrentRoundDemand(
      roundId,
      uid,
      seat,
      amount
    );

  if (!demandUpdated) {
    const potRollback =
      await rollbackPot(
        roundId,
        seat,
        amount
      );

    const userRollback =
      await rollbackUser(
        uid,
        requestId,
        amount
      );

    return setRequestStatus(
      requestId,
      potRollback &&
      userRollback
        ? "rejected"
        : "manual_review",
      {
        reason:
          "Round demand update failed"
      }
    );
  }

  // Update current-round Top 3.
  await updateTop3Demand(
    roundId
  );

  console.log(
    "SELECTION ACCEPTED",
    {
      requestId,
      uid,
      roundId,
      seat,
      amount
    }
  );

  await setRequestStatus(
    requestId,
    "accepted",
    {
      processed_uid:
        uid,

      processed_round_id:
        roundId,

      processed_seat:
        seat,

      processed_amount:
        amount
    }
  );
}

/* =========================================================
   REQUEST LISTENER
   ========================================================= */

betRequestsRef.on(
  "child_added",
  async (snapshot) => {
    const requestId =
      snapshot.key;

    const request =
      snapshot.val();

    if (!requestId) {
      return;
    }

    try {
      await processSelectionRequest(
        requestId,
        request
      );
    } catch (e) {
      console.error(
        "REQUEST PROCESS ERROR",
        e
      );

      try {
        await setRequestStatus(
          requestId,
          "rejected",
          {
            reason:
              "Internal request processing error"
          }
        );
      } catch (_) {}
    }
  }
);

/* =========================================================
   NEW ROUND
   ========================================================= */

async function createNewRound(
  reason
) {
  if (
    roundOperationRunning
  ) {
    return null;
  }

  roundOperationRunning =
    true;

  try {
    stopPotDisplay();

    const currentSnap =
      await roundRef.once(
        "value"
      );

    const current =
      currentSnap.val() ||
      {};

    const oldId =
      String(
        current.round_id ||
          "0"
      );

    const oldNumber =
      Number.isFinite(
        Number(oldId)
      )
        ? Number(oldId)
        : 0;

    const newRoundId =
      String(
        oldNumber + 1
      );

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
        newRoundId,

      status:
        "waiting",

      started_at:
        now,

      reveal_at:
        revealAt,

      // Actual aggregate demand.
      // Never used for Pot display.
      pot: {
        A: 0,
        B: 0,
        C: 0
      },

      // Random display value.
      pot_display: {
        A: 0,
        B: 0,
        C: 0,
        updated_at:
          now
      },

      // Hidden until reveal.
      cards:
        null,

      results:
        null,

      winner:
        null,

      // Reset Top 3 every round.
      top3: {
        1: null,
        2: null,
        3: null,
        updated_at:
          now
      }
    };

    await roundRef.set(
      roundData
    );

    await serverRoundRef.set({
      round_id:
        newRoundId,

      cards,

      results,

      created_at:
        now
    });

    console.log(
      "NEW ROUND",
      {
        room:
          ROOM_ID,

        round:
          newRoundId,

        reason,

        winner:
          results.winner
      }
    );

    startPotDisplay(
      newRoundId
    );

    scheduleReveal(
      newRoundId,
      revealAt
    );

    return roundData;

  } catch (e) {
    console.error(
      "CREATE ROUND ERROR",
      e
    );

    return null;

  } finally {
    roundOperationRunning =
      false;
  }
}

/* =========================================================
   REVEAL
   ========================================================= */

async function revealRound(
  roundId
) {
  try {
    const snap =
      await roundRef.once(
        "value"
      );

    const round =
      snap.val();

    if (
      !round ||
      String(
        round.round_id
      ) !==
        String(roundId) ||
      round.status !==
        "waiting"
    ) {
      return false;
    }

    stopPotDisplay();

    const privateSnap =
      await serverRoundRef.once(
        "value"
      );

    const privateRound =
      privateSnap.val();

    if (
      !privateRound ||
      String(
        privateRound.round_id
      ) !==
        String(roundId)
    ) {
      return false;
    }

    const revealedAt =
      Date.now();

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
        privateRound.results
          .winner
    });

    scheduleNextRoundAfterReveal(
      roundId,
      revealedAt
    );

    return true;

  } catch (e) {
    console.error(
      "REVEAL ERROR",
      e
    );

    return false;
  }
}

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

  setTimeout(
    () => {
      revealRound(
        roundId
      ).catch((e) => {
        console.error(
          "SCHEDULE REVEAL ERROR",
          e
        );
      });
    },
    delay
  );
}

function scheduleNextRoundAfterReveal(
  roundId,
  revealedAt
) {
  const delay =
    Math.max(
      0,
      Number(revealedAt) +
        REVEAL_TIME -
        Date.now()
    );

  setTimeout(
    async () => {
      try {
        const snap =
          await roundRef.once(
            "value"
          );

        const round =
          snap.val();

        if (
          !round ||
          String(
            round.round_id
          ) !==
            String(roundId) ||
          round.status !==
            "reveal"
        ) {
          return;
        }

        await createNewRound(
          "normal cycle"
        );

      } catch (e) {
        console.error(
          "NEXT ROUND ERROR",
          e
        );
      }
    },
    delay
  );
}

/* =========================================================
   RECONCILER
   ========================================================= */

async function reconcileRound() {
  if (
    reconcileRunning
  ) {
    return;
  }

  reconcileRunning =
    true;

  try {
    const snap =
      await roundRef.once(
        "value"
      );

    const round =
      snap.val();

    if (!round) {
      await createNewRound(
        "reconcile no round"
      );

      return;
    }

    const id =
      String(
        round.round_id ||
          "0"
      );

    const status =
      String(
        round.status || ""
      ).toLowerCase();

    const now =
      Date.now();

    if (
      status ===
      "waiting"
    ) {
      const revealAt =
        Number(
          round.reveal_at ||
            0
        );

      if (!revealAt) {
        await createNewRound(
          "invalid reveal time"
        );

        return;
      }

      if (
        !potDisplayTimer
      ) {
        startPotDisplay(
          id
        );
      }

      if (
        now >= revealAt
      ) {
        await revealRound(
          id
        );
      }

      return;
    }

    if (
      status ===
      "reveal"
    ) {
      stopPotDisplay();

      const revealedAt =
        Number(
          round.revealed_at ||
            0
        );

      if (!revealedAt) {
        await roundRef.update({
          revealed_at:
            now
        });

        return;
      }

      if (
        now >=
        revealedAt +
          REVEAL_TIME
      ) {
        await createNewRound(
          "reconcile reveal finished"
        );
      }

      return;
    }

    stopPotDisplay();

    await createNewRound(
      "unknown status"
    );

  } catch (e) {
    console.error(
      "RECONCILE ERROR",
      e
    );

  } finally {
    reconcileRunning =
      false;
  }
}

/* =========================================================
   STARTUP / RECOVERY
   ========================================================= */

async function resumeExistingRound() {
  const snap =
    await roundRef.once(
      "value"
    );

  const round =
    snap.val();

  if (!round) {
    await createNewRound(
      "startup no round"
    );

    return;
  }

  const id =
    String(
      round.round_id ||
        "0"
    );

  const status =
    String(
      round.status || ""
    ).toLowerCase();

  const now =
    Date.now();

  const revealAt =
    Number(
      round.reveal_at ||
        0
    );

  if (
    status ===
      "waiting" &&
    revealAt > now
  ) {
    startPotDisplay(
      id
    );

    // Rebuild Top 3 for the current round after restart.
    await updateTop3Demand(
      id
    );

    scheduleReveal(
      id,
      revealAt
    );

    return;
  }

  if (
    status ===
    "waiting"
  ) {
    await revealRound(
      id
    );

    return;
  }

  if (
    status ===
    "reveal"
  ) {
    stopPotDisplay();

    const revealedAt =
      Number(
        round.revealed_at ||
          now
      );

    if (
      revealedAt +
        REVEAL_TIME >
      now
    ) {
      scheduleNextRoundAfterReveal(
        id,
        revealedAt
      );
    } else {
      await createNewRound(
        "startup reveal expired"
      );
    }

    return;
  }

  await createNewRound(
    "startup unknown status"
  );
}

/* =========================================================
   HTTP
   ========================================================= */

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,

      server:
        "Teen Patti Server",

      room_id:
        ROOM_ID,

      waiting_seconds:
        WAITING_TIME / 1000,

      reveal_seconds:
        REVEAL_TIME / 1000,

      selection_processor:
        "enabled",

      current_round_user_demand:
        "enabled",

      top3:
        "enabled",

      profile_name_photo:
        "enabled",

      pot_display:
        "random every 1 second",

      pot_display_path:
        "round/pot_display",

      pot_display_min:
        POT_MIN,

      pot_display_max:
        POT_MAX,

      winner:
        "server generated from cards",

      reconciler:
        "enabled"
    });
  }
);

app.get(
  "/health",
  async (req, res) => {
    try {
      const snap =
        await roundRef.once(
          "value"
        );

      const round =
        snap.val();

      res.json({
        ok: true,

        room_id:
          ROOM_ID,

        round_id:
          round?.round_id ||
          null,

        round_status:
          round?.status ||
          null,

        reveal_at:
          round?.reveal_at ||
          null,

        actual_pot:
          round?.pot ||
          null,

        pot_display:
          round?.pot_display ||
          null,

        top3:
          round?.top3 ||
          null,

        pot_display_running:
          !!potDisplayTimer,

        timestamp:
          Date.now()
      });

    } catch (e) {
      res.status(500).json({
        ok: false,
        error:
          e.message
      });
    }
  }
);

app.get(
  "/round",
  async (req, res) => {
    try {
      const snap =
        await roundRef.once(
          "value"
        );

      const round =
        snap.val();

      if (!round) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "No round found"
          });
      }

      res.json({
        ok: true,

        room_id:
          ROOM_ID,

        round
      });

    } catch (e) {
      res.status(500).json({
        ok: false,
        error:
          e.message
      });
    }
  }
);

app.post(
  "/start-round",
  async (req, res) => {
    if (
      req.headers[
        "x-admin-secret"
      ] !==
      process.env.ADMIN_SECRET
    ) {
      return res
        .status(401)
        .json({
          ok: false,
          error:
            "Unauthorized"
        });
    }

    try {
      const result =
        await createNewRound(
          "admin start"
        );

      if (!result) {
        return res
          .status(409)
          .json({
            ok: false,
            error:
              "Round operation already running"
          });
      }

      res.json({
        ok: true,

        message:
          "New round created",

        room_id:
          ROOM_ID,

        round:
          result
      });

    } catch (e) {
      res.status(500).json({
        ok: false,
        error:
          e.message
      });
    }
  }
);

app.use(
  (req, res) => {
    res
      .status(404)
      .json({
        ok: false,
        error:
          "Endpoint not found"
      });
  }
);

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "EXPRESS ERROR",
      err
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res.status(500).json({
      ok: false,
      error:
        "Internal server error"
    });
  }
);

/* =========================================================
   START
   ========================================================= */

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    async () => {
      console.log(
        "TEEN PATTI SERVER STARTED",
        {
          PORT,
          ROOM_ID
        }
      );

      console.log(
        "CURRENT ROUND USER DEMAND: ENABLED"
      );

      console.log(
        "TOP 3: ENABLED"
      );

      console.log(
        "NAME + PHOTO: ENABLED"
      );

      console.log(
        "RANDOM POT DISPLAY: ENABLED"
      );

      console.log(
        "RANDOM POT INTERVAL: 1 SECOND"
      );

      console.log(
        "SERVER WINNER: ENABLED"
      );

      try {
        await resumeExistingRound();
      } catch (e) {
        console.error(
          "STARTUP ERROR",
          e
        );
      }

      setInterval(
        () => {
          reconcileRound()
            .catch((e) => {
              console.error(
                "RECONCILER ERROR",
                e
              );
            });
        },
        RECONCILE_INTERVAL
      );
    }
  );

/* =========================================================
   SHUTDOWN
   ========================================================= */

async function shutdown(
  signal
) {
  console.log(
    signal +
      " RECEIVED"
  );

  stopPotDisplay();

  server.close(
    () => {
      process.exit(0);
    }
  );
}

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
