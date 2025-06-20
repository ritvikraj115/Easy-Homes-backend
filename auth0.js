// server/auth0.js
const { AuthenticationClient } = require('auth0');
module.exports = new AuthenticationClient({
  domain:        process.env.AUTH0_DOMAIN,
  clientId:      process.env.AUTH0_CLIENT_ID,
  clientSecret:  process.env.AUTH0_CLIENT_SECRET
});
