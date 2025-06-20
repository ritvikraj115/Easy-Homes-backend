// server/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI environment variable not set');
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser:    true,
      useUnifiedTopology: true,
      // these are no longer required in latest mongoose:
      // useCreateIndex:  true,
      // useFindAndModify: false,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

// Optional: hook into Mongoose connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose default connection open');
});
mongoose.connection.on('error', err => {
  console.error('Mongoose default connection error:', err);
});
mongoose.connection.on('disconnected', () => {
  console.log('Mongoose default connection disconnected');
});

// Graceful shutdown on app termination
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('Mongoose connection closed due to app termination');
  process.exit(0);
});

module.exports = connectDB;
