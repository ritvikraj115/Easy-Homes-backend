const mongoose = require('mongoose');

const SiteVisitSchema = new mongoose.Schema(
  {
    project: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    preferredDate: { type: Date, required: true },
    pickupAddress: { type: String },
    transportRequired: { type: String, enum: ['Yes', 'No'], default: 'Yes' },
    pickupMode: { type: String, enum: ['manual', 'map'], default: 'manual' },
    pickupLat: { type: Number },
    pickupLng: { type: Number },
    notes: { type: String },
    status: { type: String, enum: ['requested', 'confirmed', 'cancelled'], default: 'requested' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteVisit', SiteVisitSchema);
