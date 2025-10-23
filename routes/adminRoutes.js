// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const Car = require('../models/Car');
const Appointment = require('../models/Appointment');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');        // image processing
const bcrypt = require('bcryptjs');    // password hash check

// ========== Admin creds from ENV ==========
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ''; // bcrypt hash (not the plain password)

// ========== uploads dir ==========
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// ========== Multer (memory) ==========
// Keep files in memory -> compress/resize with sharp before writing.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only image files (jpg, jpeg, png, gif, webp, heic, heif) are allowed'));
    }
    cb(null, true);
  },
  limits: {
    files: 20,
    fileSize: 25 * 1024 * 1024,
  },
});

// ========== simple admin guard ==========
function isAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

router.get('/', (req, res) => res.redirect('/admin/login'));

// ========== Auth ==========
router.get('/login', (req, res) => res.render('admin/login', { error: null }));

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.render('admin/login', { error: 'Please enter username and password' });
    }
    if (!ADMIN_PASS_HASH) {
      return res.render('admin/login', { error: 'Server login is not configured' });
    }
    if (username !== ADMIN_USER) {
      return res.render('admin/login', { error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, ADMIN_PASS_HASH);
    if (!ok) {
      return res.render('admin/login', { error: 'Invalid credentials' });
    }

    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  } catch (e) {
    console.error('Login error:', e);
    return res.render('admin/login', { error: 'Login error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ========== Dashboard ==========
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const cars = await Car.find().sort({ createdAt: -1 });
    res.render('admin/dashboard', { cars });
  } catch {
    res.status(500).send('Server error');
  }
});

// ========== Appointments ==========
router.get('/appointments', isAdmin, async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ date: -1 });
    res.render('admin/appointments', { appointments });
  } catch {
    res.status(500).send('Server error');
  }
});

router.post('/appointments/:id/delete', isAdmin, async (req, res) => {
  try {
    await Appointment.findByIdAndDelete(req.params.id);
    res.redirect('/admin/appointments');
  } catch {
    res.status(500).send('Error deleting appointment');
  }
});

// ========== Add Car ==========
router.get('/add-car', isAdmin, (req, res) => {
  res.render('admin/add-car', { error: null });
});

router.post('/add-car', isAdmin, upload.array('images', 20), async (req, res) => {
  try {
    const {
      make, model, year, price, description,
      exteriorColor, interiorColor, mileage,
      engine, transmission, drivetrain, fuel, bodyStyle, vin
    } = req.body;

    const images = [];
    if (Array.isArray(req.files)) {
      const concurrency = 3;
      for (let i = 0; i < req.files.length; i += concurrency) {
        const batch = req.files.slice(i, i + concurrency);
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(batch.map(async (f) => {
          const base = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const outPath = path.join(uploadDir, `${base}.webp`);
          const publicUrl = `/uploads/${path.basename(outPath)}`;

          await sharp(f.buffer)
            .rotate()
            .resize({ width: 1600, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(outPath);

          images.push(publicUrl);
        }));
      }
    }

    const newCar = new Car({
      make: (make || '').trim(),
      model: (model || '').trim(),
      year: year ? parseInt(year, 10) : undefined,
      price: price ? parseFloat(price) : undefined,
      description: (description || '').trim(),
      exteriorColor: (exteriorColor || '').trim(),
      interiorColor: (interiorColor || '').trim(),
      mileage: mileage ? parseInt(mileage, 10) : undefined,
      engine: (engine || '').trim(),
      transmission: (transmission || '').trim(),
      drivetrain: (drivetrain || '').trim(),
      fuel: (fuel || '').trim(),
      bodyStyle: (bodyStyle || '').trim(),
      vin: (vin || '').trim(),
      images
    });

    await newCar.save();
    res.redirect('/admin/dashboard');
  } catch (error) {
    console.error('Error saving car:', error);
    res.status(500).send('Error saving car');
  }
});

// ========== Delete Car ==========
router.post('/cars/:id/delete', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (car && Array.isArray(car.images)) {
      car.images.forEach(imgUrl => {
        const diskPath = path.join(__dirname, '..', imgUrl);
        if (fs.existsSync(diskPath)) {
          try { fs.unlinkSync(diskPath); } catch {}
        }
      });
    }
    await Car.findByIdAndDelete(req.params.id);
    res.redirect('/admin/dashboard');
  } catch {
    res.status(500).send('Error deleting car');
  }
});

// ========== Edit Car ==========
router.get('/cars/:id/edit', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).send('Car not found');
    res.render('admin/edit-car', { car, error: null });
  } catch {
    res.status(500).send('Server error');
  }
});

router.post('/cars/:id/edit', isAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const car = await Car.findById(id);
    if (!car) return res.status(404).send('Car not found');

    if (req.body.price === undefined || req.body.price === null || req.body.price === '') {
      return res.status(400).send('Price is required');
    }
    const parsedPrice = parseFloat(req.body.price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).send('Price must be a positive number');
    }
    car.price = parsedPrice;

    car.description = (req.body.description ?? '').trim();

    const setIfProvided = (key, transform = v => v) => {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const val = req.body[key];
        if (val !== '' && val !== null && val !== undefined) {
          car[key] = transform(val);
        }
      }
    };

    setIfProvided('exteriorColor', v => v.trim());
    setIfProvided('interiorColor', v => v.trim());
    setIfProvided('mileage',      v => parseInt(v, 10));
    setIfProvided('engine',       v => v.trim());
    setIfProvided('transmission', v => v.trim());
    setIfProvided('drivetrain',   v => v.trim());
    setIfProvided('fuel',         v => v.trim());
    setIfProvided('bodyStyle',    v => v.trim());
    setIfProvided('vin',          v => v.trim());

    if (typeof req.body.imagesOrder === 'string') {
      const requestedOrder = req.body.imagesOrder.split(',').map(s => s.trim()).filter(Boolean);
      if (requestedOrder.length > 0 && Array.isArray(car.images)) {
        const currentSet = new Set(car.images.map(String));
        const cleaned = requestedOrder.filter(u => currentSet.has(u));
        const rest = car.images.filter(u => !cleaned.includes(u));
        car.images = [...cleaned, ...rest];
      }
    }

    await car.save();
    res.redirect('/admin/dashboard');
  } catch (error) {
    console.error('Error updating car:', error);
    res.status(500).send('Error updating car');
  }
});

module.exports = router;
