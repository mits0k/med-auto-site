const mongoose = require('mongoose');

const tireProfitSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now
  },
  amount: {
    type: Number,
    default: 0
  },
  note: String
}, { timestamps: true });

module.exports =
  mongoose.models.TireProfit ||
  mongoose.model('TireProfit', tireProfitSchema);
