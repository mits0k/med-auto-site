const SiteSetting = require('../models/SiteSetting');

const TIRE_SALES_KEY = 'tireSalesEnabled';
const DEFAULT_TIRE_SALES_ENABLED = process.env.TIRE_SALES_ENABLED !== 'false';

async function getTireSalesEnabled() {
  const setting = await SiteSetting.findOne({ key: TIRE_SALES_KEY }).lean();
  return setting ? setting.enabled !== false : DEFAULT_TIRE_SALES_ENABLED;
}

async function setTireSalesEnabled(enabled) {
  const setting = await SiteSetting.findOneAndUpdate(
    { key: TIRE_SALES_KEY },
    { $set: { enabled: Boolean(enabled) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return setting.enabled !== false;
}

module.exports = {
  getTireSalesEnabled,
  setTireSalesEnabled,
  DEFAULT_TIRE_SALES_ENABLED
};
