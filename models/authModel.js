// server/models/Auth.js
const mongoose = require('mongoose');
const bcrypt   = require('bcrypt');

const authSchema = new mongoose.Schema({
  name:                 { type: String, required: true },
  email:                { type: String, required: true, unique: true },
  password:             { type: String, required: true },
  otp:                  { type: String },
  otpExpiresAt:         { type: Date },
  resetPasswordToken:   { type: String },
  resetPasswordExpires: { type: Date },
  isVerified:           { type: Boolean, default: false },

  // ← New field: store MLS numbers of saved properties
  favorites:            { type: [String], default: [] }
}, { timestamps: true });

// Hash password before saving
authSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

authSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('Auth', authSchema);




