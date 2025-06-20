const Auth     = require('../models/authModel');
const jwt      = require('jsonwebtoken');
const sendMail = require('../utils/sendMail.js');
const crypto   = require('crypto')

// Generate a 6‑digit OTP
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}


exports.signup = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    // 1. Check for existing user
    if (await Auth.findOne({ email })) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    // 2. Create new user (password will be hashed by pre-save hook)
    const user = new Auth({ name, email, password });
    await user.save();

    // 3. Generate & email OTP
    const otp       = generateOtp();
    const expiresAt = new Date(Date.now() + 60 * 1000);
    user.otp          = otp;
    user.otpExpiresAt = expiresAt;
    await user.save();

    await sendMail({
      to:      email,
      subject: 'Verify your Easy Homes account',
      text:    `Hi ${name}, your Easy Homes OTP is ${otp}. It expires in 1 minute.`
    });

    // 4. Tell client to go verify
    res.json({
      success: true,
      needsVerification: true,
      message: 'Account created. Please verify via the code sent to your email.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await Auth.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Email not found' });
    }

    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    // if user not yet verified → send a fresh OTP and tell client to go to OTP page
    if (!user.isVerified) {
      const otp       = generateOtp();
      const expiresAt = new Date(Date.now() + 60 * 1000);

      await Auth.findByIdAndUpdate(user._id, {
        otp,
        otpExpiresAt: expiresAt
      });

      await sendMail({
        to:      email,
        subject: 'Your Easy Homes OTP',
        text:    `Your OTP code is ${otp}. It expires in 1 minute.`
      });

      return res.json({
        success: true,
        needsVerification: true,
        message: 'Account not verified. OTP sent to your email.'
      });
    }

    // otherwise issue JWT
    const token = jwt.sign(
      { sub: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendOtp = async (req, res) => {
  const { email } = req.body;
  try {
    const otp       = generateOtp();
    const expiresAt = new Date(Date.now() + 60 * 1000); // 1 minute

    await Auth.findOneAndUpdate(
      { email },
      { otp, otpExpiresAt: expiresAt, isVerified: false },
      { upsert: true, new: true }
    );

    await sendMail({
      to:      email,
      subject: 'Your Easy Homes OTP',
      text:    `Your OTP code is ${otp}. It expires in 1 minute.`
    });

    res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const record = await Auth.findOne({ email });
    if (!record) {
      return res.status(400).json({ success: false, message: 'No OTP requested for this email' });
    }
    if (record.otp !== otp || record.otpExpiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP is invalid or expired' });
    }

    // Mark as verified
    record.isVerified    = true;
    record.otp            = null;
    record.otpExpiresAt   = null;
    await record.save();

    // Issue JWT
    const token = jwt.sign(
      { sub: record._id, email: record.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// server/controllers/auth.controller.js
exports.logout = async (req, res) => {
  try {
    // Clear the JWT cookie (must match the name, path, and options you used when setting it)
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // true if using HTTPS
      sameSite: 'strict'
    });
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ success: false, message: 'Server error on logout' });
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await Auth.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Email not found' });
    }

    // Generate secure random token
    const buffer = crypto.randomBytes(32);
    const token  = buffer.toString('hex');
    const expires = Date.now() + 3600 * 1000; // 1 hour

    // Store hashed token in DB
    user.resetPasswordToken   = crypto.createHash('sha256').update(token).digest('hex');
    user.resetPasswordExpires = new Date(expires);
    await user.save();

    // Send reset link to user
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    await sendMail({
      to:      email,
      subject: 'Reset Your Easy Homes Password',
      text:    `Click here to reset your password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.`
    });

    res.json({ success: true, message: 'Password reset link sent to your email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * 2. User hits reset-password endpoint with token, email, newPassword.
 */
exports.resetPassword = async (req, res) => {
  const { token, email, newPassword } = req.body;
  try {
    // Re-hash incoming token to compare
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await Auth.findOne({
      email,
      resetPasswordToken:   hashedToken,
      resetPasswordExpires: { $gt: new Date() }
    });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Token invalid or expired' });
    }

    // Set new password and clear reset fields
    user.password             = newPassword;
    user.resetPasswordToken   = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

