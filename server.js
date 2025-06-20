require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const connectDb= require('./config/db')
const auth0Routes = require('./routes/auth0Routes');
const app = express();
app.use(express.json());

// Add your MongoDB URI
connectDb();

app.use('/api/auth', authRoutes);
app.use('/api/auth0', auth0Routes);

// … other middleware, routes, error handlers …

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
