const mongoose = require('mongoose');

const partRequestSchema = new mongoose.Schema({
  partType: {
    type: String,
    default: 'Tire'
  },
  supplier: {
    type: String,
    default: 'Dodo Wheels'
  },
  supplierProductId: String,
  supplierUrl: String,
  brand: String,
  model: String,
  size: String,
  season: String,
  quantity: {
    type: Number,
    default: 4
  },
  priceCents: Number,
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerPhone: {
    type: String,
    required: true,
    trim: true
  },
  customerEmail: {
    type: String,
    trim: true
  },
  vehicle: {
    type: String,
    trim: true
  },
  note: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['Awaiting E-Transfer', 'Payment Received', 'Awaiting Stock Check', 'Payment Captured', 'Hold Cancelled'],
    default: 'Awaiting E-Transfer'
  },
  paymentMethod: {
    type: String,
    default: 'E-Transfer'
  },
  paymentReceivedAt: Date,
  customerNotifiedAt: Date,
  stripePaymentIntentId: {
    type: String,
    trim: true
  },
  stripeCheckoutSessionId: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports =
  mongoose.models.PartRequest ||
  mongoose.model('PartRequest', partRequestSchema);
