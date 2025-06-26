// server/controllers/favouriteController.js
const Auth = require('../models/authModel');

exports.getFavourites = async (req, res) => {
  // req.user injected by requireAuth
  res.json(req.user.favorites);
};

exports.addFavourite = async (req, res) => {
  const { mlsNumber } = req.params;
  if (!mlsNumber) return res.status(400).json({ error: 'Missing MLS' });

  const user = req.user;
  if (!user.favorites.includes(mlsNumber)) {
    user.favorites.push(mlsNumber);
    await user.save();
  }
  res.json(user.favorites);
};

exports.removeFavourite = async (req, res) => {
  const { mlsNumber } = req.params;
  const user = req.user;
  user.favorites = user.favorites.filter(x => x !== mlsNumber);
  await user.save();
  res.json(user.favorites);
};
