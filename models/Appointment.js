const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,

  // Exact date+time of the booking
  date: Date,

  // Optional note from the customer
  message: String,

  // Which car they want to see (optional)
  car: { type: mongoose.Schema.Types.ObjectId, ref: 'Car', required: false },
  carLabel: String, // e.g., "2015 BMW 328i"

  createdAt: { type: Date, default: Date.now }
});

// 👇 use existing model if it’s already compiled
module.exports =
  mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
