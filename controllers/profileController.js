// server/controllers/profileController.js
const Auth   = require('../models/authModel');
const redis  = require('../config/redis');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Helper to build the user cache key
const userCacheKey = (userId) => `user:${userId}`;

exports.getProfile = async (req, res, next) => {
  // req.user injected by your auth middleware
  res.json({ success: true, user: req.user });
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const updates = {};
    if (name)  updates.name  = name;
    if (email) updates.email = email;

    const userId = req.user._id;
    const user = await Auth.findByIdAndUpdate(
      userId,
      updates,
      { new: true }
    ).select('-password -otp*');

    // Invalidate the Redis cache for this user
    await redis.del(userCacheKey(userId));

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    const user = await Auth.findById(userId);
    const match = await user.comparePassword(currentPassword);
    if (!match) {
      return res
        .status(400)
        .json({ success: false, message: 'Current password invalid' });
    }

    user.password = newPassword;
    await user.save();

    // Invalidate the Redis cache for this user
    await redis.del(userCacheKey(userId));

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    next(err);
  }
};
