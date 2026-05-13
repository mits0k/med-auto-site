const mongoose = require('mongoose');

const tradeInSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  email: {
    type: String,
    trim: true
  },

  phone: {
    type: String,
    required: true,
    trim: true
  },

  year: {
    type: Number,
    required: true
  },

  make: {
    type: String,
    required: true,
    trim: true
  },

  model: {
    type: String,
    required: true,
    trim: true
  },

  mileage: {
    type: Number,
    required: true
  },

  vin: {
    type: String,
    trim: true
  },

  condition: {
    type: String,
    trim: true
  },

  askingPrice: {
    type: Number
  },

  message: {
    type: String,
    trim: true
  },

  images: [String],

  status: {
    type: String,
    enum: ['New', 'Contacted', 'Closed'],
    default: 'New'
  }

}, {
  timestamps: true
});

module.exports =
  mongoose.models.TradeIn ||
  mongoose.model('TradeIn', tradeInSchema);