const jwt = require('jsonwebtoken');

module.exports = function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing admin token' });
  }

  const token = header.split(' ')[1];
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

  try {
    const payload = jwt.verify(token, secret);
    if (payload?.type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token' });
  }
};
