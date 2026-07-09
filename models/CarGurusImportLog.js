const mongoose = require('mongoose');

const carGurusImportLogSchema = new mongoose.Schema({
  fileName: String,
  totalRows: {
    type: Number,
    default: 0
  },
  matchedRows: {
    type: Number,
    default: 0
  },
  unmatchedRows: {
    type: Number,
    default: 0
  },
  conflictRows: {
    type: Number,
    default: 0
  },
  appliedRows: {
    type: Number,
    default: 0
  },
  createdRows: {
    type: Number,
    default: 0
  },
  summary: String
}, { timestamps: true });

module.exports =
  mongoose.models.CarGurusImportLog ||
  mongoose.model('CarGurusImportLog', carGurusImportLogSchema);
