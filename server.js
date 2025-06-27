// server/index.js (or app.js)
require('dotenv').config();
const express         = require('express');
const cors            = require('cors');
const connectDb       = require('./config/db');
const authRoutes      = require('./routes/authRoutes');
const auth0Routes     = require('./routes/auth0Routes');
const favouriteRoutes = require('./routes/favouriteRoutes');
const profileRoutes = require('./routes/profileRoutes');


const app = express();

// === CORS SETUP ===
// You can either allow all origins (for development)…

// …or be explicit in production:
app.use(cors({
  origin: [process.env.FRONTEND_URL],
  credentials: true
}));

// === JSON PARSER ===
app.use(express.json());

// === DB CONNECT ===
connectDb();

// === ROUTES ===
app.use('/api/auth', authRoutes);
app.use('/api/auth0', auth0Routes);
app.use('/api/favourites', favouriteRoutes);
app.use('/api/profile', profileRoutes);
// === ERROR HANDLING ===
// (your error handlers here)

// === START SERVER ===
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));


