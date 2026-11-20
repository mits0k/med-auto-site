const mongoose = require('mongoose');

const partRequestSchema = new mongoose.Schema({
  partType: {
    type: String,
    default: 'Tire'
  },
  supplier: {
    type: String,
    default: 'Tire supplier'
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
    enum: ['Awaiting E-Transfer', 'Awaiting Payment', 'Payment Cancelled', 'Payment Received', 'Awaiting Stock Check', 'Payment Captured', 'Hold Cancelled', 'Refund Pending', 'Payment Refunded'],
    default: 'Awaiting E-Transfer'
  },
  paymentMethod: {
    type: String,
    default: 'E-Transfer'
  },
  paymentReceivedAt: Date,
  orderEmailSentAt: Date,
  customerNotifiedAt: Date,
  cancellationEmailSentAt: Date,
  stripePaymentIntentId: {
    type: String,
    trim: true
  },
  stripeRefundId: {
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
