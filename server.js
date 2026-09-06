const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase Admin initialize karein
admin.initializeApp();

const app = express();
app.use(express.json());
app.use(cors());

// 1. Place Bet Endpoint
app.post('/placeTeenPattiBet', async (req, res) => {
    try {
        const { uid, side, amount, roundId } = req.body;
        // Yahan apna betting validation aur database update logic likhein
        
        res.status(200).json({ success: true, message: "Bet placed successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Get Round Endpoint
app.post('/getTeenPattiRound', async (req, res) => {
    try {
        const { roundId } = req.body;
        // Round data, cards aur winner return karein
        res.status(200).json({ bettingOpen: false, cards: [], winner: 1 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Settle Round Endpoint
app.post('/settleTeenPattiRound', async (req, res) => {
    try {
        const { roundId } = req.body;
        res.status(200).json({ success: true, message: "Settled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
