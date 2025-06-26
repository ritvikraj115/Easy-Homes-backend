// server/middleware/requireAuth.js
const jwt    = require('jsonwebtoken');
const Auth   = require('../models/authModel');

module.exports = async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const { sub:userId } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await Auth.findById(userId);
    if (!user) throw new Error();
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
