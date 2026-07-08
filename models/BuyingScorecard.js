const mongoose = require('mongoose');

const buyingScorecardSchema = new mongoose.Schema({
  year: Number,
  make: String,
  model: String,
  trim: String,
  mileage: Number,
  expectedRetail: {
    type: Number,
    default: 0
  },
  proposedPurchasePrice: {
    type: Number,
    default: 0
  },
  auctionFees: {
    type: Number,
    default: 0
  },
  transport: {
    type: Number,
    default: 0
  },
  estimatedRecon: {
    type: Number,
    default: 0
  },
  expectedDaysToSell: {
    type: Number,
    default: 45
  },
  carfaxNotes: String,
  mechanicalRiskNotes: String,
  decision: String,
  score: Number
}, { timestamps: true });

module.exports =
  mongoose.models.BuyingScorecard ||
  mongoose.model('BuyingScorecard', buyingScorecardSchema);
