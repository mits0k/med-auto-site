const mongoose = require('mongoose');

const offsiteCarProfitSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now
  },
  vehicleLabel: String,
  purchaseCost: {
    type: Number,
    default: 0
  },
  salePrice: {
    type: Number,
    default: 0
  },
  note: String
}, { timestamps: true });

module.exports =
  mongoose.models.OffsiteCarProfit ||
  mongoose.model('OffsiteCarProfit', offsiteCarProfitSchema);
