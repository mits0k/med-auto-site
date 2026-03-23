const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  make: String,
  model: String,
  year: Number,
  price: Number,

  // NEW
  sold: {
    type: Boolean,
    default: false
  },

  // short text you still control
  description: String,

  // NEW structured specs (all optional so existing cars still work)
  exteriorColor: String,
  interiorColor: String,
  mileage: Number,
  engine: String,
  transmission: String,
  drivetrain: String,
  fuel: String,
  bodyStyle: String,
  vin: String,

  images: [String]
}, { timestamps: true });

// reuse compiled model if it exists
module.exports = mongoose.models.Car || mongoose.model('Car', carSchema);