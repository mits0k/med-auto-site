const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');

const Car = require('../models/Car');
const Appointment = require('../models/Appointment');
const TradeIn = require('../models/TradeIn');
const BuyingScorecard = require('../models/BuyingScorecard');
const CarGurusImportLog = require('../models/CarGurusImportLog');
const {
  ACTION_GROUPS,
  LEAD_SOURCES,
  LEAD_STAGES,
  buildDashboard,
  getBuyingScorecardMetrics,
  getVehicleMetrics,
  toNumber
} = require('../utils/commandCenter');

// ===== Admin creds from env =====
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || '';

// ===== Ensure uploads dir exists =====
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// ===== Multer =====
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!allowed.includes(ext)) {
      return cb(new Error('Only image files allowed'));
    }

    cb(null, true);
  },
  limits: {
    files: 30,
    fileSize: 25 * 1024 * 1024,
  },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.csv', '.txt'].includes(ext)) {
      return cb(new Error('Only CSV files allowed'));
    }
    cb(null, true);
  },
  limits: {
    files: 1,
    fileSize: 4 * 1024 * 1024
  }
});

// ===== Admin Guard =====
function isAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

const displaySort = {
  sold: 1,
  displayOrder: 1,
  createdAt: -1
};

async function normalizeDisplayOrder(filter = {}) {
  const cars = await Car.find(filter).sort(displaySort);

  await Promise.all(
    cars.map((car, index) => {
      const nextOrder = (index + 1) * 10;
      if (typeof car.displayOrder === 'number' && car.displayOrder === nextOrder) {
        return null;
      }

      car.displayOrder = nextOrder;
      return car.save();
    }).filter(Boolean)
  );

  return cars.map((car, index) => {
    car.displayOrder = (index + 1) * 10;
    return car;
  });
}

async function getNextTopDisplayOrder() {
  const firstCar = await Car.findOne({ sold: { $ne: true } })
    .sort({ displayOrder: 1, createdAt: -1 })
    .select('displayOrder')
    .lean();

  return typeof firstCar?.displayOrder === 'number'
    ? firstCar.displayOrder - 10
    : 0;
}

router.get('/', (req, res) => res.redirect('/admin/login'));

// ===== LOGIN =====
router.get('/login', (req, res) => {
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  try {

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.render('admin/login', {
        error: 'Please enter username and password'
      });
    }

    if (!ADMIN_PASS_HASH) {
      return res.render('admin/login', {
        error: 'Server login is not configured'
      });
    }

    if (username !== ADMIN_USER) {
      return res.render('admin/login', {
        error: 'Invalid credentials'
      });
    }

    const ok = await bcrypt.compare(password, ADMIN_PASS_HASH);

    if (!ok) {
      return res.render('admin/login', {
        error: 'Invalid credentials'
      });
    }

    req.session.admin = true;

    return res.redirect('/admin/dashboard');

  } catch (e) {

    console.error('Login error:', e);

    return res.render('admin/login', {
      error: 'Login error'
    });

  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ===== DASHBOARD =====
router.get('/dashboard', isAdmin, async (req, res) => {
  try {

    let cars = await Car.find().sort(displaySort);
    const unorderedCount = await Car.countDocuments({ displayOrder: { $exists: false } });

    if (unorderedCount > 0 || cars.some(car => typeof car.displayOrder !== 'number')) {
      cars = await normalizeDisplayOrder();
    }

    res.render('admin/dashboard', { cars });

  } catch (e) {

    console.error(e);
    res.status(500).send('Server error');

  }
});

// ===== APPOINTMENTS =====
router.get('/appointments', isAdmin, async (req, res) => {
  try {

    const appointments = await Appointment.find().sort({
      date: -1
    });

    res.render('admin/appointments', {
      appointments
    });

  } catch (e) {

    console.error(e);
    res.status(500).send('Server error');

  }
});

router.post('/appointments/:id/delete', isAdmin, async (req, res) => {
  try {

    await Appointment.findByIdAndDelete(req.params.id);
    res.redirect('/admin/appointments');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error deleting appointment');

  }
});

// ===============================
// TRADE-IN REQUESTS
// ===============================

router.get('/trade-ins', isAdmin, async (req, res) => {
  try {

    const tradeIns = await TradeIn.find()
      .sort({ createdAt: -1 });

    res.render('admin/trade-ins', {
      tradeIns
    });

  } catch (e) {

    console.error(e);
    res.status(500).send('Server error');

  }
});

router.post('/trade-ins/:id/status', isAdmin, async (req, res) => {
  try {

    const tradeIn = await TradeIn.findById(req.params.id);

    if (!tradeIn) {
      return res.status(404).send('Trade-in not found');
    }

    tradeIn.status = req.body.status || 'New';

    await tradeIn.save();

    res.redirect('/admin/trade-ins');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error updating trade-in');

  }
});

router.post('/trade-ins/:id/delete', isAdmin, async (req, res) => {
  try {

    await TradeIn.findByIdAndDelete(req.params.id);

    res.redirect('/admin/trade-ins');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error deleting trade-in');

  }
});

// ===============================
// COMMAND CENTER
// ===============================

function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'undefined') return [];
  return [value];
}

function normalizeVin(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeStock(value) {
  return String(value || '').trim().toUpperCase();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

function getCsvValue(row, aliases) {
  const keys = Object.keys(row);
  const normalizedAliases = aliases.map(alias => alias.toLowerCase());
  const key = keys.find(item => normalizedAliases.includes(item.toLowerCase()));
  if (key) return row[key];

  return '';
}

function buildCarDraftFromCsvRow(raw) {
  const year = toNumber(getCsvValue(raw, ['Year', 'Vehicle Year', 'Model Year']));
  const make = getCsvValue(raw, ['Make', 'Vehicle Make']);
  const model = getCsvValue(raw, ['Model', 'Vehicle Model']);
  const trim = getCsvValue(raw, ['Trim', 'Vehicle Trim']);
  const mileage = toNumber(getCsvValue(raw, ['Mileage', 'Kilometers', 'Odometer', 'KM', 'KMs']));
  const exteriorColor = getCsvValue(raw, ['Exterior Color', 'Exterior', 'Color']);
  const interiorColor = getCsvValue(raw, ['Interior Color', 'Interior']);
  const transmission = getCsvValue(raw, ['Transmission']);
  const drivetrain = getCsvValue(raw, ['Drivetrain', 'Drive Type']);
  const fuel = getCsvValue(raw, ['Fuel', 'Fuel Type']);
  const bodyStyle = getCsvValue(raw, ['Body Style', 'Body']);

  return {
    year: year || undefined,
    make: make || 'Unknown Make',
    model: model || 'Unknown Model',
    trim,
    mileage: mileage || undefined,
    exteriorColor,
    interiorColor,
    transmission,
    drivetrain,
    fuel,
    bodyStyle
  };
}

function buildCsvPreview(fileName, csvText, cars) {
  const parsed = parseCsv(csvText);
  const headers = (parsed.shift() || []).map(header => String(header || '').trim());
  const inventory = cars.map(car => ({
    id: String(car._id),
    label: `${car.year || ''} ${car.make || ''} ${car.model || ''}`.trim(),
    vin: normalizeVin(car.vin),
    stockNumber: normalizeStock(car.stockNumber)
  }));

  const rows = parsed.map((values, index) => {
    const raw = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = values[headerIndex] || '';
    });

    const vin = normalizeVin(getCsvValue(raw, ['VIN', 'vin', 'Vehicle VIN']));
    const stockNumber = normalizeStock(getCsvValue(raw, ['Stock #', 'Stock', 'Stock Number', 'stockNumber']));
    const vinMatches = vin ? inventory.filter(car => car.vin && vin === car.vin) : [];
    const stockMatches = stockNumber ? inventory.filter(car => car.stockNumber && stockNumber === car.stockNumber) : [];
    const conflicts = [];
    let match = null;

    if (vinMatches.length === 1) {
      match = vinMatches[0];

      if (stockNumber && match.stockNumber && stockNumber !== match.stockNumber) {
        conflicts.push(`Stock conflict: VIN matches ${match.label}, but CSV stock is ${stockNumber}`);
      }
    } else if (vinMatches.length > 1) {
      conflicts.push(`VIN conflict: ${vin} matches multiple vehicles`);
    } else if (stockMatches.length === 1) {
      match = stockMatches[0];
    } else if (stockMatches.length > 1) {
      conflicts.push(`Stock conflict: ${stockNumber} matches multiple vehicles; VIN is required`);
    }

    const askingPrice = toNumber(getCsvValue(raw, ['Price', 'Asking Price', 'List Price', 'Current Price']));
    const saves = toNumber(getCsvValue(raw, ['Saves', 'Saved', 'Save Count']));
    const imv = toNumber(getCsvValue(raw, ['IMV', 'CarGurus IMV', 'Instant Market Value']));
    const dealRating = getCsvValue(raw, ['Deal Rating', 'Deal', 'Rating']);
    const daysOnMarket = toNumber(getCsvValue(raw, ['Days on CarGurus', 'Days on Market', 'DOM']));
    const draft = buildCarDraftFromCsvRow(raw);
    const canCreate = !match && Boolean(vin || stockNumber);

    if (match && askingPrice > 0) {
      const car = cars.find(item => String(item._id) === match.id);
      if (car && toNumber(car.price) > 0 && toNumber(car.price) !== askingPrice) {
        conflicts.push(`Asking price differs: site $${toNumber(car.price).toLocaleString()} vs CSV $${askingPrice.toLocaleString()}`);
      }
    }

    return {
      index,
      raw,
      vin,
      stockNumber,
      carId: match ? match.id : '',
      vehicleLabel: match ? match.label : '',
      askingPrice,
      saves,
      imv,
      dealRating,
      daysOnMarket,
      matched: Boolean(match),
      canCreate,
      draft,
      conflicts
    };
  });

  return {
    fileName,
    headers,
    rows,
    createdAt: new Date().toISOString()
  };
}

function buildScorecardFromBody(body) {
  return {
    year: toNumber(body.year),
    make: String(body.make || '').trim(),
    model: String(body.model || '').trim(),
    trim: String(body.trim || '').trim(),
    mileage: toNumber(body.mileage),
    expectedRetail: toNumber(body.expectedRetail),
    proposedPurchasePrice: toNumber(body.proposedPurchasePrice),
    auctionFees: toNumber(body.auctionFees),
    transport: toNumber(body.transport),
    estimatedRecon: toNumber(body.estimatedRecon),
    expectedDaysToSell: toNumber(body.expectedDaysToSell) || 45,
    carfaxNotes: String(body.carfaxNotes || '').trim(),
    mechanicalRiskNotes: String(body.mechanicalRiskNotes || '').trim()
  };
}

router.get('/command-center', isAdmin, async (req, res) => {
  try {
    const sort = req.query.sort || 'days';
    const status = req.query.status || 'active';
    const search = String(req.query.search || '').trim().toLowerCase();
    const filter = status === 'sold' ? { sold: true } : status === 'all' ? {} : { sold: { $ne: true } };
    const allCars = await Car.find().sort(displaySort);
    const cars = await Car.find(filter).sort(displaySort);
    const appointments = await Appointment.find({ date: { $gte: new Date() } }).select('car date carLabel').lean();
    const dashboard = buildDashboard(allCars, appointments);
    const tableDashboard = buildDashboard(cars, appointments);

    let rows = tableDashboard.rows;

    if (search) {
      rows = rows.filter(row => {
        const haystack = [
          row.metrics.label,
          row.car.vin,
          row.car.stockNumber,
          row.car.adminStatus,
          row.car.cargurus?.dealRating
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }

    rows.sort((a, b) => {
      if (sort === 'roi') return b.metrics.roi - a.metrics.roi;
      if (sort === 'gross') {
        const aGross = a.car.sold ? a.metrics.soldGross : a.metrics.potentialGross;
        const bGross = b.car.sold ? b.metrics.soldGross : b.metrics.potentialGross;
        return bGross - aGross;
      }
      if (sort === 'days') return b.metrics.daysInStock - a.metrics.daysInStock;
      if (sort === 'capital') return b.metrics.totalInvested - a.metrics.totalInvested;
      if (sort === 'leads') return b.metrics.leadCounts.total - a.metrics.leadCounts.total;
      return a.metrics.recommendation.group.localeCompare(b.metrics.recommendation.group) || b.metrics.daysInStock - a.metrics.daysInStock;
    });

    const leadFunnel = rows
      .flatMap(row => (row.car.leads || []).map(lead => ({
        vehicle: row.metrics.label,
        source: lead.source || 'other',
        stage: lead.stage || 'New Lead',
        date: lead.date,
        customerName: lead.customerName,
        notes: lead.notes
      })))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    res.render('admin/command-center', {
      rows,
      leadFunnel,
      kpis: dashboard.kpis,
      soldProfit: dashboard.soldProfit,
      ACTION_GROUPS,
      filters: { sort, status, search }
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Error loading command center');
  }
});

router.get('/command-center/weekly', isAdmin, async (req, res) => {
  try {
    const cars = await Car.find({ sold: { $ne: true } }).sort(displaySort);
    const appointments = await Appointment.find({ date: { $gte: new Date() } }).select('car date carLabel').lean();
    const dashboard = buildDashboard(cars, appointments);
    const groups = ACTION_GROUPS.map(group => ({
      group,
      rows: dashboard.rows.filter(row => row.metrics.recommendation.group === group)
    }));

    res.render('admin/weekly-action-center', { groups });
  } catch (e) {
    console.error(e);
    res.status(500).send('Error loading weekly action center');
  }
});

router.get('/command-center/buying-scorecard', isAdmin, async (req, res) => {
  try {
    const scorecards = await BuyingScorecard.find().sort({ createdAt: -1 }).limit(40);
    res.render('admin/buying-scorecard', {
      scorecards,
      getBuyingScorecardMetrics,
      draft: null,
      error: null
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Error loading buying scorecard');
  }
});

router.post('/command-center/buying-scorecard', isAdmin, async (req, res) => {
  try {
    const draft = buildScorecardFromBody(req.body);
    const metrics = getBuyingScorecardMetrics(draft);
    const scorecard = new BuyingScorecard({
      ...draft,
      decision: metrics.decision,
      score: metrics.capitalEfficiencyScore
    });

    await scorecard.save();
    res.redirect('/admin/command-center/buying-scorecard');
  } catch (e) {
    console.error(e);
    const scorecards = await BuyingScorecard.find().sort({ createdAt: -1 }).limit(40);
    res.status(500).render('admin/buying-scorecard', {
      scorecards,
      getBuyingScorecardMetrics,
      draft: req.body,
      error: 'Could not save scorecard'
    });
  }
});

router.post('/command-center/buying-scorecard/:id/delete', isAdmin, async (req, res) => {
  try {
    await BuyingScorecard.findByIdAndDelete(req.params.id);
    res.redirect('/admin/command-center/buying-scorecard');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error deleting scorecard');
  }
});

router.get('/command-center/cargurus-import', isAdmin, async (req, res) => {
  try {
    const logs = await CarGurusImportLog.find().sort({ createdAt: -1 }).limit(10);
    res.render('admin/cargurus-import', {
      preview: req.session.cargurusPreview || null,
      logs,
      error: null
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Error loading CSV import');
  }
});

router.post('/command-center/cargurus-import/preview', isAdmin, csvUpload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.redirect('/admin/command-center/cargurus-import');
    }

    const cars = await Car.find().select('year make model vin stockNumber price');
    const preview = buildCsvPreview(req.file.originalname, req.file.buffer.toString('utf8'), cars);
    req.session.cargurusPreview = preview;
    req.session.save(() => res.redirect('/admin/command-center/cargurus-import'));
  } catch (e) {
    console.error(e);
    const logs = await CarGurusImportLog.find().sort({ createdAt: -1 }).limit(10);
    res.status(500).render('admin/cargurus-import', {
      preview: null,
      logs,
      error: 'Could not preview this CSV'
    });
  }
});

router.post('/command-center/cargurus-import/apply', isAdmin, async (req, res) => {
  try {
    const preview = req.session.cargurusPreview;
    if (!preview) {
      return res.redirect('/admin/command-center/cargurus-import');
    }

    let appliedRows = 0;
    let createdRows = 0;

    for (const row of preview.rows) {
      if (!row.matched) {
        if (!row.canCreate || (!row.vin && !row.stockNumber)) continue;

        const draft = row.draft || {};
        const newCar = new Car({
          make: draft.make || 'Unknown Make',
          model: draft.model || 'Unknown Model',
          year: draft.year || undefined,
          price: row.askingPrice || 0,
          trim: draft.trim || '',
          stockNumber: row.stockNumber || '',
          sold: false,
          displayOrder: await getNextTopDisplayOrder(),
          description: 'Imported from CarGurus. Add full listing details, photos, and private financials before publishing.',
          exteriorColor: draft.exteriorColor || '',
          interiorColor: draft.interiorColor || '',
          mileage: draft.mileage || undefined,
          transmission: draft.transmission || '',
          drivetrain: draft.drivetrain || '',
          fuel: draft.fuel || '',
          bodyStyle: draft.bodyStyle || '',
          vin: row.vin || '',
          adminStatus: 'Needs Photos',
          privateNotes: 'Created from CarGurus CSV import. Add purchase cost and private financial details.',
          cargurus: {
            saves: row.saves,
            imv: row.imv || undefined,
            dealRating: row.dealRating || '',
            daysOnMarket: row.daysOnMarket || undefined,
            lastImportedAt: new Date()
          },
          images: []
        });

        await newCar.save();
        createdRows += 1;
        continue;
      }

      if (!row.carId) continue;

      const car = await Car.findById(row.carId);
      if (!car) continue;

      car.cargurus = car.cargurus || {};
      car.cargurus.saves = row.saves;
      car.cargurus.imv = row.imv || undefined;
      car.cargurus.dealRating = row.dealRating || '';
      car.cargurus.daysOnMarket = row.daysOnMarket || undefined;
      car.cargurus.lastImportedAt = new Date();

      if (row.askingPrice > 0 && toNumber(car.price) !== row.askingPrice) {
        car.priceHistory.push({
          date: new Date(),
          oldPrice: toNumber(car.price),
          newPrice: row.askingPrice,
          reason: 'CarGurus CSV import',
          savesBeforeChange: toNumber(car.cargurus.saves),
          leadsBeforeChange: (car.leads || []).length,
          appointmentsBeforeChange: (car.leads || []).filter(lead => lead.stage === 'Appointment Set').length
        });
        car.price = row.askingPrice;
      }

      await car.save();
      appliedRows += 1;
    }

    await new CarGurusImportLog({
      fileName: preview.fileName,
      totalRows: preview.rows.length,
      matchedRows: preview.rows.filter(row => row.matched).length,
      unmatchedRows: preview.rows.filter(row => !row.matched).length,
      conflictRows: preview.rows.filter(row => row.conflicts.length > 0).length,
      appliedRows,
      createdRows,
      summary: 'Updated matched vehicles and created draft listings for unmatched rows with VIN or stock number. Private financial data was not touched.'
    }).save();

    req.session.cargurusPreview = null;
    req.session.save(() => res.redirect('/admin/command-center/cargurus-import'));
  } catch (e) {
    console.error(e);
    res.status(500).send('Error applying CSV import');
  }
});

router.post('/command-center/cargurus-import/clear', isAdmin, (req, res) => {
  req.session.cargurusPreview = null;
  req.session.save(() => res.redirect('/admin/command-center/cargurus-import'));
});

// ===== Helper =====
async function processAndSaveImage(fileBuffer, mimetype) {

  const base = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  const outPath = path.join(uploadDir, `${base}.webp`);

  const publicUrl = `/uploads/${path.basename(outPath)}`;

  try {

    const meta = await sharp(fileBuffer).metadata();

    const isSmallWebp =
      (mimetype === 'image/webp' ||
      (meta.format || '').toLowerCase() === 'webp') &&
      fileBuffer.length <= 800 * 1024 &&
      (meta.width || 0) <= 1280;

    if (isSmallWebp) {

      await fs.promises.writeFile(outPath, fileBuffer);
      return publicUrl;

    }

    await sharp(fileBuffer)
      .rotate()
      .resize({
        width: 1280,
        withoutEnlargement: true
      })
      .webp({
        quality: 72,
        effort: 3
      })
      .toFile(outPath);

    return publicUrl;

  } catch (err) {

    console.error(err);
    return null;

  }
}

async function processFilesInBatches(files, batchSize = 2) {

  const urls = [];

  for (let i = 0; i < files.length; i += batchSize) {

    const batch = files.slice(i, i + batchSize);

    const results = await Promise.all(
      batch.map(f =>
        processAndSaveImage(f.buffer, f.mimetype)
      )
    );

    for (const url of results) {
      if (url) urls.push(url);
    }
  }

  return urls;
}

// ===== ADD CAR =====
router.get('/add-car', isAdmin, (req, res) => {
  res.render('admin/add-car', { error: null });
});

router.post('/add-car', isAdmin, upload.array('images', 30), async (req, res) => {

  try {

    const {
      make,
      model,
      trim,
      stockNumber,
      year,
      price,
      description,
      exteriorColor,
      interiorColor,
      mileage,
      engine,
      transmission,
      drivetrain,
      fuel,
      bodyStyle,
      vin
    } = req.body;

    let images = [];

    if (Array.isArray(req.files) && req.files.length) {
      images = await processFilesInBatches(req.files, 2);
    }

    const newCar = new Car({
      make,
      model,
      trim,
      stockNumber,
      year,
      price,
      sold: false,
      displayOrder: await getNextTopDisplayOrder(),
      description,
      exteriorColor,
      interiorColor,
      mileage,
      engine,
      transmission,
      drivetrain,
      fuel,
      bodyStyle,
      vin,
      images
    });

    await newCar.save();

    res.redirect('/admin/dashboard');

  } catch (error) {

    console.error(error);
    res.status(500).send('Error saving car');

  }
});

// ===== EDIT CAR PAGE =====
router.get('/cars/:id/edit', isAdmin, async (req, res) => {
  try {

    const car = await Car.findById(req.params.id);

    if (!car) {
      return res.status(404).send('Car not found');
    }

    res.render('admin/edit-car', {
      car,
      metrics: getVehicleMetrics(car),
      LEAD_SOURCES,
      LEAD_STAGES,
      error: null
    });

  } catch (e) {

    console.error(e);
    res.status(500).send('Error loading edit page');

  }
});

// ===== SAVE EDITED CAR =====
router.post('/cars/:id/edit', isAdmin, upload.array('newImages', 30), async (req, res) => {
  try {

    const car = await Car.findById(req.params.id);

    if (!car) {
      return res.status(404).send('Car not found');
    }

    const {
    make,
    model,
    trim,
    stockNumber,
    price,
    description,
    exteriorColor,
    interiorColor,
    mileage,
    engine,
    transmission,
    drivetrain,
    fuel,
    bodyStyle,
    vin,
    imagesOrder,
    deletedImages,
    priceChangeReason,
    purchaseCost,
    purchaseDate,
    auctionSource,
    auctionFees,
    transportCost,
    inspectionCost,
    adminStatus,
    privateNotes,
    activeBuyerStatus,
    recommendationOverride,
    recommendationNote,
    saleDate,
    finalSalePrice,
    cargurusSaves,
    cargurusImv,
    cargurusDealRating,
    cargurusDaysOnMarket
} = req.body;

    // Delete removed images
    if (deletedImages) {

      const deletedList = deletedImages
        .split(',')
        .filter(Boolean);

      deletedList.forEach(imgUrl => {

        const relative =
          imgUrl.startsWith('/')
            ? imgUrl.slice(1)
            : imgUrl;

        const diskPath = path.join(__dirname, '..', relative);

        if (fs.existsSync(diskPath)) {
          try {
            fs.unlinkSync(diskPath);
          } catch {}
        }
      });

      car.images = car.images.filter(
        img => !deletedList.includes(img)
      );
    }

    // Reorder existing images
    if (imagesOrder) {

      const ordered = imagesOrder
        .split(',')
        .filter(Boolean);

      car.images = ordered;
    }

    // Add new uploaded images
    if (Array.isArray(req.files) && req.files.length > 0) {

      const newImages = await processFilesInBatches(req.files, 2);

      car.images.push(...newImages);
    }

    const oldPrice = toNumber(car.price);
    const nextPrice = toNumber(price);

    // Update fields
    car.make = make;
    car.model = model;
    car.trim = trim;
    car.stockNumber = stockNumber;
    car.price = price;
    car.description = description;
    car.exteriorColor = exteriorColor;
    car.interiorColor = interiorColor;
    car.mileage = mileage;
    car.engine = engine;
    car.transmission = transmission;
    car.drivetrain = drivetrain;
    car.fuel = fuel;
    car.bodyStyle = bodyStyle;
    car.vin = vin;
    car.purchaseCost = toNumber(purchaseCost);
    car.purchaseDate = parseDate(purchaseDate);
    car.auctionSource = auctionSource;
    car.auctionFees = toNumber(auctionFees);
    car.transportCost = toNumber(transportCost);
    car.inspectionCost = toNumber(inspectionCost);
    car.adminStatus = adminStatus || 'Retail Ready';
    car.privateNotes = privateNotes;
    car.activeBuyerStatus = activeBuyerStatus;
    car.recommendationOverride = recommendationOverride;
    car.recommendationNote = recommendationNote;
    car.saleDate = parseDate(saleDate);
    car.finalSalePrice = finalSalePrice === '' ? undefined : toNumber(finalSalePrice);
    car.cargurus = car.cargurus || {};
    car.cargurus.saves = toNumber(cargurusSaves);
    car.cargurus.imv = cargurusImv === '' ? undefined : toNumber(cargurusImv);
    car.cargurus.dealRating = cargurusDealRating || '';
    car.cargurus.daysOnMarket = cargurusDaysOnMarket === '' ? undefined : toNumber(cargurusDaysOnMarket);

    const reconDates = formArray(req.body.reconDate);
    const reconCategories = formArray(req.body.reconCategory);
    const reconDescriptions = formArray(req.body.reconDescription);
    const reconAmounts = formArray(req.body.reconAmount);

    car.reconExpenses = reconAmounts
      .map((amount, index) => ({
        date: parseDate(reconDates[index]),
        category: String(reconCategories[index] || '').trim(),
        description: String(reconDescriptions[index] || '').trim(),
        amount: toNumber(amount)
      }))
      .filter(item => item.amount > 0 || item.category || item.description || item.date);

    const leadDates = formArray(req.body.leadDate);
    const leadSources = formArray(req.body.leadSource);
    const leadStages = formArray(req.body.leadStage);
    const leadCustomers = formArray(req.body.leadCustomerName);
    const leadContacts = formArray(req.body.leadContact);
    const leadNotes = formArray(req.body.leadNotes);

    car.leads = leadSources
      .map((source, index) => ({
        date: parseDate(leadDates[index]) || new Date(),
        source: String(source || '').trim(),
        stage: String(leadStages[index] || '').trim(),
        customerName: String(leadCustomers[index] || '').trim(),
        contact: String(leadContacts[index] || '').trim(),
        notes: String(leadNotes[index] || '').trim()
      }))
      .filter(item => item.source || item.stage || item.customerName || item.contact || item.notes);

    if (oldPrice !== nextPrice && nextPrice > 0) {
      car.priceHistory.push({
        date: new Date(),
        oldPrice,
        newPrice: nextPrice,
        reason: String(priceChangeReason || 'Admin price update').trim(),
        savesBeforeChange: toNumber(car.cargurus?.saves),
        leadsBeforeChange: (car.leads || []).length,
        appointmentsBeforeChange: (car.leads || []).filter(lead => lead.stage === 'Appointment Set').length
      });
    }

    await car.save();

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error saving edited car');

  }
});

// ===== TOGGLE SOLD =====
router.post('/cars/:id/toggle-sold', isAdmin, async (req, res) => {
  try {

    const car = await Car.findById(req.params.id);

    if (!car) {
      return res.status(404).send('Car not found');
    }

    car.sold = !car.sold;

    if (car.sold) {
      car.isFeatured = false;
      if (!car.saleDate) car.saleDate = new Date();
      if (!car.finalSalePrice && car.price) car.finalSalePrice = car.price;
    }

    await car.save();

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error updating sold status');

  }
});

// ===== DISPLAY ORDER =====
router.post('/cars/order', isAdmin, async (req, res) => {
  try {

    const submittedOrder = req.body.order || {};
    const cars = await normalizeDisplayOrder();

    const requested = Object.entries(submittedOrder)
      .map(([id, value]) => {
        const position = parseInt(value, 10);
        const car = cars.find(c => String(c._id) === String(id));
        return Number.isInteger(position) && position > 0 && car
          ? { car, position }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.position - b.position);

    const requestedIds = new Set(requested.map(item => String(item.car._id)));
    const orderedCars = cars.filter(car => !requestedIds.has(String(car._id)));

    requested.forEach(item => {
      const nextIndex = Math.min(item.position - 1, orderedCars.length);
      orderedCars.splice(nextIndex, 0, item.car);
    });

    await Promise.all(
      orderedCars.map((car, index) => {
        car.displayOrder = (index + 1) * 10;
        return car.save();
      })
    );

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error saving display order');

  }
});

router.post('/cars/:id/move', isAdmin, async (req, res) => {
  try {

    const targetCar = await Car.findById(req.params.id);

    if (!targetCar) {
      return res.status(404).send('Car not found');
    }

    const direction = req.body.direction === 'down' ? 'down' : 'up';
    const cars = await normalizeDisplayOrder({ sold: targetCar.sold });
    const index = cars.findIndex(car => String(car._id) === String(targetCar._id));

    if (index === -1) {
      return res.redirect('/admin/dashboard');
    }

    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    if (swapIndex < 0 || swapIndex >= cars.length) {
      return res.redirect('/admin/dashboard');
    }

    const current = cars[index];
    const swapWith = cars[swapIndex];
    const currentOrder = current.displayOrder;

    current.displayOrder = swapWith.displayOrder;
    swapWith.displayOrder = currentOrder;

    await Promise.all([
      current.save(),
      swapWith.save()
    ]);

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error updating display order');

  }
});

// ===== HOMEPAGE FEATURE =====
router.post('/cars/:id/feature', isAdmin, async (req, res) => {
  try {

    const car = await Car.findById(req.params.id);

    if (!car) {
      return res.status(404).send('Car not found');
    }

    if (car.sold) {
      return res.redirect('/admin/dashboard');
    }

    await Car.updateMany({}, { $set: { isFeatured: false } });
    car.isFeatured = true;
    await car.save();

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error updating homepage feature');

  }
});

// ===== DELETE CAR =====
router.post('/cars/:id/delete', isAdmin, async (req, res) => {
  try {

    const car = await Car.findById(req.params.id);

    if (car && Array.isArray(car.images)) {

      car.images.forEach(imgUrl => {

        const relative =
          imgUrl.startsWith('/')
            ? imgUrl.slice(1)
            : imgUrl;

        const diskPath = path.join(__dirname, '..', relative);

        if (fs.existsSync(diskPath)) {
          try {
            fs.unlinkSync(diskPath);
          } catch {}
        }

      });
    }

    await Car.findByIdAndDelete(req.params.id);

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error deleting car');

  }
});

module.exports = router;
