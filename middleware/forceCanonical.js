module.exports = function forceCanonical(req, res, next) {
  const host = req.headers.host;

  // Force non-www
  if (host === 'www.easyhomess.com') {
    return res.redirect(
      301,
      'https://easyhomess.com' + req.originalUrl
    );
  }

  next();
};
