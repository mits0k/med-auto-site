const mongoose = require('mongoose');

const reconExpenseSchema = new mongoose.Schema({
  date: Date,
  category: String,
  description: String,
  amount: {
    type: Number,
    default: 0
  }
}, { _id: true });

const leadSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now
  },
  source: String,
  stage: String,
  customerName: String,
  contact: String,
  notes: String
}, { _id: true });

const priceHistorySchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now
  },
  oldPrice: Number,
  newPrice: Number,
  reason: String,
  savesBeforeChange: Number,
  leadsBeforeChange: Number,
  appointmentsBeforeChange: Number,
  notes: String
}, { _id: true });

const carSchema = new mongoose.Schema({
  make: String,
  model: String,
  year: Number,
  price: Number,
  trim: String,
  stockNumber: String,

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

  displayOrder: {
    type: Number,
    default: 0
  },

  isFeatured: {
    type: Boolean,
    default: false
  },

  adminStatus: {
    type: String,
    default: 'Retail Ready'
  },

  purchaseCost: {
    type: Number,
    default: 0
  },
  purchaseDate: Date,
  auctionSource: String,
  auctionFees: {
    type: Number,
    default: 0
  },
  transportCost: {
    type: Number,
    default: 0
  },
  inspectionCost: {
    type: Number,
    default: 0
  },
  reconExpenses: [reconExpenseSchema],
  privateNotes: String,
  activeBuyerStatus: String,
  recommendationOverride: String,
  recommendationNote: String,
  saleDate: Date,
  finalSalePrice: Number,

  cargurus: {
    saves: {
      type: Number,
      default: 0
    },
    imv: Number,
    dealRating: String,
    daysOnMarket: Number,
    lastImportedAt: Date
  },

  leads: [leadSchema],
  priceHistory: [priceHistorySchema],

  images: [String]
}, { timestamps: true });

// reuse compiled model if it exists
module.exports = mongoose.models.Car || mongoose.model('Car', carSchema);
