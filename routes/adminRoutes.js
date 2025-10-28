// routes/adminRoutes.js
const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');

const Car = require('../models/Car');
const Appointment = require('../models/Appointment');

// ===== Admin creds from env =====
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ''; // bcrypt hash (NOT the plain password)

// ===== Ensure uploads dir exists =====
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// ===== Multer: keep files in memory for Sharp =====
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
    files: 20,                       // you can still select many; we’ll restrict below
    fileSize: 25 * 1024 * 1024,      // 25MB per file max
  },
});

// ===== Very simple admin guard =====
function isAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

router.get('/', (req, res) => res.redirect('/admin/login'));

// ===== Auth =====
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

// ===== Dashboard =====
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const cars = await Car.find().sort({ createdAt: -1 });
    res.render('admin/dashboard', { cars });
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// ===== Appointments =====
router.get('/appointments', isAdmin, async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ date: -1 });
    res.render('admin/appointments', { appointments });
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

// ===== Helper: process one image buffer fast =====
async function processAndSaveImage(fileBuffer, mimetype) {
  const base = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const outPath = path.join(uploadDir, `${base}.webp`);
  const publicUrl = `/uploads/${path.basename(outPath)}`;

  try {
    // If it's already a small-ish webp, skip recompression
    const meta = await sharp(fileBuffer).metadata();
    const isSmallWebp =
      (mimetype === 'image/webp' || (meta.format || '').toLowerCase() === 'webp') &&
      fileBuffer.length <= 800 * 1024 &&                    // <= 800 KB
      (meta.width || 0) <= 1280;

    if (isSmallWebp) {
      await fs.promises.writeFile(outPath, fileBuffer);
      return publicUrl;
    }

    // Fast-ish settings: width 1280, quality 72, effort 3
    await sharp(fileBuffer)
      .rotate()
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 72, effort: 3 })
      .toFile(outPath);

    return publicUrl;
  } catch (err) {
    console.error('[image process] sharp failed:', err);
    return null;
  }
}

// ===== Helper: process files in small batches =====
async function processFilesInBatches(files, batchSize = 2) {
  const urls = [];
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(f => processAndSaveImage(f.buffer, f.mimetype))
    );
    for (const url of results) {
      if (url) urls.push(url);
    }
  }
  return urls;
}

// ===== Add Car =====
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

    // gentle cap to keep things snappy
    if (req.files && req.files.length > 12) {
      return res.status(400).send('Please upload at most 12 photos at once. Try again with a smaller batch.');
    }

    let images = [];
    if (Array.isArray(req.files) && req.files.length) {
      images = await processFilesInBatches(req.files, 2);
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
    return res.redirect('/admin/dashboard');
  } catch (error) {
    console.error('Error saving car:', error);
    return res.status(500).send('Error saving car');
  }
});

// ===== Delete Car =====
router.post('/cars/:id/delete', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (car && Array.isArray(car.images)) {
      car.images.forEach(imgUrl => {
        const relative = imgUrl.startsWith('/') ? imgUrl.slice(1) : imgUrl;
        const diskPath = path.join(__dirname, '..', relative);
        if (fs.existsSync(diskPath)) {
          try { fs.unlinkSync(diskPath); } catch {}
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

// ===== Edit Car (supports adding more photos) =====
router.get('/cars/:id/edit', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).send('Car not found');
    res.render('admin/edit-car', { car, error: null });
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

router.post(
  '/cars/:id/edit',
  isAdmin,
  upload.array('newImages', 12), // accept additional photos here
  async (req, res) => {
    try {
      const car = await Car.findById(req.params.id);
      if (!car) return res.status(404).send('Car not found');

      // price required and positive
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

      // Reorder existing images (if provided)
      if (typeof req.body.imagesOrder === 'string' && car.images && car.images.length) {
        const requestedOrder = req.body.imagesOrder
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        if (requestedOrder.length > 0) {
          const currentSet = new Set(car.images.map(String));
          const cleaned = requestedOrder.filter(u => currentSet.has(u));
          const rest = car.images.filter(u => !cleaned.includes(u));
          car.images = [...cleaned, ...rest];
        }
      }

      // Append any newly uploaded images (fast pipeline + batching)
      if (Array.isArray(req.files) && req.files.length) {
        const newUrls = await processFilesInBatches(req.files, 2);
        car.images.push(...newUrls);
      }

      await car.save();
      res.redirect('/admin/dashboard');
    } catch (error) {
      console.error('Error updating car:', error);
      res.status(500).send('Error updating car');
    }
  }
);

module.exports = router;
