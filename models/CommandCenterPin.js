const mongoose = require('mongoose');

const commandCenterPinSchema = new mongoose.Schema({
  key: {
    type: String,
    default: 'command-center',
    unique: true,
    immutable: true
  },
  pinHash: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CommandCenterPin', commandCenterPinSchema);
