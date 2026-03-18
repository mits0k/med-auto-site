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
    files: 30, // increased from 20
    fileSize: 25 * 1024 * 1024,
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
    const meta = await sharp(fileBuffer).metadata();
    const isSmallWebp =
      (mimetype === 'image/webp' || (meta.format || '').toLowerCase() === 'webp') &&
      fileBuffer.length <= 800 * 1024 &&
      (meta.width || 0) <= 1280;

    if (isSmallWebp) {
      await fs.promises.writeFile(outPath, fileBuffer);
      return publicUrl;
    }

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

// ===== Helper: safely delete uploaded image from disk =====
function deleteImageFromDisk(img) {
  const relative = img.startsWith('/') ? img.slice(1) : img;

  if (!relative.startsWith('uploads/')) return;

  const diskPath = path.resolve(__dirname, '..', relative);
  const safeUploadDir = path.resolve(uploadDir);

  if (diskPath.startsWith(safeUploadDir) && fs.existsSync(diskPath)) {
    try {
      fs.unlinkSync(diskPath);
    } catch (err) {
      console.error('Failed deleting image from disk:', err);
    }
  }
}

// ===== Add Car =====
router.get('/add-car', isAdmin, (req, res) => {
  res.render('admin/add-car', { error: null });
});

router.post('/add-car', isAdmin, upload.array('images', 30), async (req, res) => {
  try {
    const {
      make, model, year, price, description,
      exteriorColor, interiorColor, mileage,
      engine, transmission, drivetrain, fuel, bodyStyle, vin
    } = req.body;

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
      car.images.forEach(deleteImageFromDisk);
    }
    await Car.findByIdAndDelete(req.params.id);
    res.redirect('/admin/dashboard');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error deleting car');
  }
});

// ===== Edit Car =====
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
  upload.array('newImages', 30),
  async (req, res) => {
    try {
      const car = await Car.findById(req.params.id);
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
      setIfProvided('mileage', v => parseInt(v, 10));
      setIfProvided('engine', v => v.trim());
      setIfProvided('transmission', v => v.trim());
      setIfProvided('drivetrain', v => v.trim());
      setIfProvided('fuel', v => v.trim());
      setIfProvided('bodyStyle', v => v.trim());
      setIfProvided('vin', v => v.trim());

      // Images the user wants removed during this save
      let deletedExistingImages = [];
      if (typeof req.body.deletedImages === 'string' && req.body.deletedImages.trim()) {
        deletedExistingImages = req.body.deletedImages
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      }

      // Remove deleted existing images from car.images
      if (deletedExistingImages.length) {
        car.images = (car.images || []).filter(img => !deletedExistingImages.includes(String(img)));
      }

      // Process newly uploaded images
      let newUrls = [];
      if (Array.isArray(req.files) && req.files.length) {
        newUrls = await processFilesInBatches(req.files, 2);
      }

      // Desired final order can include:
      // - existing URLs like /uploads/abc.webp
      // - new temp ids like new_0, new_1
      let finalImages = [];
      const existingSet = new Set((car.images || []).map(String));

      const newImagesMap = {};
      newUrls.forEach((url, index) => {
        newImagesMap[`new_${index}`] = url;
      });

      if (typeof req.body.imagesOrder === 'string' && req.body.imagesOrder.trim()) {
        const requestedOrder = req.body.imagesOrder
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        for (const item of requestedOrder) {
          if (existingSet.has(item)) {
            finalImages.push(item);
            existingSet.delete(item);
          } else if (newImagesMap[item]) {
            finalImages.push(newImagesMap[item]);
            delete newImagesMap[item];
          }
        }
      }

      // Append anything not already included
      finalImages.push(...Array.from(existingSet));
      finalImages.push(...Object.values(newImagesMap));

      car.images = finalImages;

      await car.save();

      // delete removed files from disk after save
      deletedExistingImages.forEach(deleteImageFromDisk);

      res.redirect('/admin/dashboard');
    } catch (error) {
      console.error('Error updating car:', error);
      res.status(500).send('Error updating car');
    }
  }
);

module.exports = router;