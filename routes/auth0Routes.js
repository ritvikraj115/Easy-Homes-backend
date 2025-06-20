// server/routes/auth0.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const auth0 = require('../auth0');
const User = require('../models/authModel');
const router = express.Router();

router.post('/verify-token', async (req, res) => {
    const { idToken } = req.body;
    try {
        const decoded = jwt.decode(idToken, { complete: true });
        if (!decoded?.payload?.email) {
            return res.status(400).json({ success: false, message: 'Invalid ID token' });
        }
        const { email, name, sub } = decoded.payload;

        let user = await User.findOne({ email });
        if (user) {
            const isPassword= await user.comparePassword(sub)
            // CASE A: Local‐password account (password set, but doesn’t match this social sub)
            if (user.password && !isPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'An account with this email already exists. Please sign in with email & password.'
                });
            }

            // CASE B: Existing social‐login user (password field is empty/null OR matches sub)
            // → fall through and issue JWT

        } else {
            // CASE C: First‐time social login → create new user
            user = await User.create({
                name: name || '',
                email,
                password: sub,      // dummy marker so we can recognize this as social
                isVerified: true
            });
        }

        // Issue our own JWT
        const ourToken = jwt.sign(
            { sub: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            success: true,
            token: ourToken,
            user: {
                id: user._id,
                email: user.email,
                name: user.name
            }
        });

    } catch (err) {
        console.error('verify-token error:', err);
        res.status(500).json({ success: false, message: 'Authentication failed' });
    }
});

module.exports = router;
