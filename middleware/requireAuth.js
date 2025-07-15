// server/middleware/requireAuth.js
const jwt    = require('jsonwebtoken');
const Auth   = require('../models/authModel');
const redis  = require('../config/redis');

const USER_CACHE_TTL = 60 * 60; // 1 hour

module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.split(' ')[1];

  try {
    // 1. Verify JWT and extract userId
    const { sub: userId } = jwt.verify(token, process.env.JWT_SECRET);

    // 2. Try to fetch user from Redis cache
    const cacheKey = `user:${userId}`;
    let userJson = await redis.get(cacheKey);

    let user;
    if (userJson) {
      console.log('cached user');
      user = JSON.parse(userJson);
    } else {
      // 3. Cache miss → load from DB
      console.log('not found user cache');
      user = await Auth.findById(userId).lean();
      if (!user) throw new Error('User not found');
      // 4. Store in cache
      try {
        await redis.set(cacheKey, JSON.stringify(user), 'EX', USER_CACHE_TTL);
        console.log('middleware cached');
        
      } catch (error) {
        console.log(error)
        
      }
    }

    // 5. Attach to request and proceed
    req.user = user;
    next();

  } catch (err) {
    console.error('requireAuth error:', err);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
