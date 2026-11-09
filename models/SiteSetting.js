const mongoose = require('mongoose');

const siteSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  enabled: {
    type: Boolean,
    required: true,
    default: true
  }
}, {
  timestamps: true
});

module.exports =
  mongoose.models.SiteSetting ||
  mongoose.model('SiteSetting', siteSettingSchema);
