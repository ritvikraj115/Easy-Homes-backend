const Auth = require('../models/authModel');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

exports.getProfile = async (req, res, next) => {
  // req.userId set by ensureAuthenticated middleware
 
  res.json({ success: true, user:req.user });
};

exports.updateProfile = async (req, res, next) => {
  const { name, email } = req.body;
  const updates = {};
  if (name)  updates.name  = name;
  if (email) updates.email = email;
  const user = await Auth.findByIdAndUpdate(req.user._id, updates, { new: true })
    .select('-password -otp*');
  res.json({ success: true, user });
};

exports.changePassword = async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const user = await Auth.findById(req.user._id);
  const match = await user.comparePassword(currentPassword);
  if (!match) return res.status(400).json({ success: false, message: 'Current password invalid' });
  user.password = newPassword;
  await user.save();
  res.json({ success: true, message: 'Password updated' });
};

exports.getFavorites = async (req, res, next) => {
  const user = await Auth.findById(req.userId).select('favorites');
  res.json({ success: true, favorites: user.favorites });
};

exports.addFavorite = async (req, res, next) => {
  const { mlsId } = req.body;
  await Auth.findByIdAndUpdate(req.userId, {
    $addToSet: { favorites: mlsId }
  });
  res.json({ success: true });
};

exports.removeFavorite = async (req, res, next) => {
  const { mlsId } = req.params;
  await Auth.findByIdAndUpdate(req.userId, {
    $pull: { favorites: mlsId }
  });
  res.json({ success: true });
};
