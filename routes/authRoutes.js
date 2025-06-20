// server/routes/auth.routes.js
const express    = require('express');
const ctrl = require('../controllers/authController');
const router     = express.Router();

router.post('/signup',         ctrl.signup);
router.post('/login',          ctrl.login);
router.post('/send-otp',       ctrl.sendOtp);
router.post('/verify-otp',     ctrl.verifyOtp);
router.post('/forgot-password',ctrl.forgotPassword);  // ← new
router.post('/reset-password', ctrl.resetPassword);   // ← new
router.post('/logout',         ctrl.logout);

module.exports = router;



