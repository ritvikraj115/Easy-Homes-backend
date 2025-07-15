// server/controllers/favouriteController.js
const Auth = require('../models/authModel');
const redis = require('../config/redis');

// Helper to build per-user cache key
const favKey = (user) => `favourites:${user._id}`;

exports.getFavourites = async (req, res) => {
  try {
    const user = req.user;       // from middleware, may be a plain object
    const key  = favKey(user);

    // 1️⃣ Try cache
    const cached = await redis.get(key);
    if (cached) {
      console.log(cached);
      return res.json(JSON.parse(cached));
    }

    // 2️⃣ Cache miss → fetch fresh from DB
    const freshUser = await Auth.findById(user._id).lean();
    const favs = freshUser.favorites || [];

    // 3️⃣ Cache it
    try {
       await redis.set(key, JSON.stringify(favs), 'EX', 600);
       console.log('fav cached');
      
    } catch (error) {
      console.log(error);
      
    }
   
    return res.json(favs);

  } catch (err) {
    console.error('Error in getFavourites:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.addFavourite = async (req, res) => {
  try {
    const { mlsNumber } = req.params;
    if (!mlsNumber) {
      return res.status(400).json({ error: 'Missing MLS number' });
    }

    // 1️⃣ Fetch the real Mongoose user document
    const userDoc = await Auth.findById(req.user._id);
    if (!userDoc) return res.status(404).json({ error: 'User not found' });

    const key = favKey(userDoc);

    // 2️⃣ Update only if not present
    if (!userDoc.favorites.includes(mlsNumber)) {
      userDoc.favorites.push(mlsNumber);
      await userDoc.save();

      // 3️⃣ Invalidate cache
      await redis.del(key);
    }

    return res.json(userDoc.favorites);

  } catch (err) {
    console.error('Error in addFavourite:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.removeFavourite = async (req, res) => {
  try {
    const { mlsNumber } = req.params;

    // 1️⃣ Fetch the real Mongoose user document
    const userDoc = await Auth.findById(req.user._id);
    if (!userDoc) return res.status(404).json({ error: 'User not found' });

    const key = favKey(userDoc);

    // 2️⃣ Remove if exists
    userDoc.favorites = userDoc.favorites.filter(x => x !== mlsNumber);
    await userDoc.save();

    // 3️⃣ Invalidate cache
    await redis.del(key);

    return res.json(userDoc.favorites);

  } catch (err) {
    console.error('Error in removeFavourite:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};


