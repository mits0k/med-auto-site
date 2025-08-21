const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  make: String,
  model: String,
  year: Number,
  price: Number,

  // short text you still control
  description: String,

  // NEW structured specs (all optional so existing cars still work)
  exteriorColor: String,
  interiorColor: String,
  mileage: Number,           // store km or miles (you choose in UI label)
  engine: String,            // e.g., "3.0L I6 TwinPower Turbo"
  transmission: String,      // e.g., "8-speed automatic"
  drivetrain: String,        // e.g., "AWD / RWD / FWD"
  fuel: String,              // e.g., "Gasoline / Diesel / Hybrid"
  bodyStyle: String,         // e.g., "Sedan / SUV / Coupe"
  vin: String,

  images: [String]
}, { timestamps: true });

// 👇 reuse compiled model if it exists
module.exports = mongoose.models.Car || mongoose.model('Car', carSchema);
