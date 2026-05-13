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

// ===== Admin Guard =====
function isAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
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

    const cars = await Car.find().sort({
      sold: 1,
      createdAt: -1
    });

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
      year,
      price,
      sold: false,
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

// ===== TOGGLE SOLD =====
router.post('/cars/:id/toggle-sold', isAdmin, async (req, res) => {
  try {

    const car = await Car.findById(req.params.id);

    if (!car) {
      return res.status(404).send('Car not found');
    }

    car.sold = !car.sold;

    await car.save();

    res.redirect('/admin/dashboard');

  } catch (e) {

    console.error(e);
    res.status(500).send('Error updating sold status');

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