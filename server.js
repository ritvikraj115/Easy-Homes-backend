require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const connectDb = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const auth0Routes = require('./routes/auth0Routes');
const favouriteRoutes = require('./routes/favouriteRoutes');
const profileRoutes = require('./routes/profileRoutes');
const geocodeRoutes = require('./routes/geocodeRoutes');

const app = express();

// === CORS SETUP ===
app.use(cors({
  origin: [process.env.FRONTEND_URL],
  credentials: true,
}));

// === JSON PARSER ===
app.use(express.json());

// === DB CONNECT ===
connectDb()
  .then(() => console.log('✅ DB connected'))
  .catch(err => {
    console.error('❌ DB connection error:', err);
    process.exit(1);
  });

// === ROUTES ===
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ▶ ${req.method} ${req.originalUrl}`);
  next();
});
app.use('/api/auth', authRoutes);
app.use('/api/auth0', auth0Routes);
app.use('/api/favourites', favouriteRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/geocode', geocodeRoutes);

// === HEALTH CHECK ===
app.get('/healthz', (_, res) => res.status(200).send('OK'));

// === ERROR HANDLING ===
app.use((err, req, res, next) => {
  console.error('💥 ERROR:', err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

// === START SERVER ===
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

const KEEP_ALIVE = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10) || 120_000;
const HEADERS_TIMEOUT = parseInt(process.env.HEADERS_TIMEOUT, 10) || 125_000;

server.keepAliveTimeout = KEEP_ALIVE;
server.headersTimeout = HEADERS_TIMEOUT;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log(`→ keepAliveTimeout = ${KEEP_ALIVE}ms`);
  console.log(`→ headersTimeout   = ${HEADERS_TIMEOUT}ms`);
});

// === HANDLE UNCAUGHT ERRORS ===
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection:', reason, 'at', p);
});
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
