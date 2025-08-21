// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const Car = require('../models/Car');
const Appointment = require('../models/Appointment');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ---------- Multer (uploads) ----------
const storage = multer.diskStorage({
  destination(req, file, cb) {
    // Always use the absolute /uploads next to project root
    const uploadDir = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    cb(
      null,
      Date.now() +
        '-' +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname).toLowerCase()
    );
  },
});

const upload = multer({
  storage,
  fileFilter(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'));
    }
    cb(null, true);
  },
  // optional: limit file size to ~8 MB
  // limits: { fileSize: 8 * 1024 * 1024 },
});

// ---------- very simple admin guard ----------
function isAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

router.get('/', (req, res) => res.redirect('/admin/login'));

// ---------- Auth ----------
router.get('/login', (req, res) => res.render('admin/login', { error: null }));

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '1234') {
    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { error: 'Invalid credentials' });
});

// (optional) simple logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---------- Dashboard ----------
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const cars = await Car.find().sort({ createdAt: -1 });
    res.render('admin/dashboard', { cars });
  } catch {
    res.status(500).send('Server error');
  }
});

// ---------- Appointments ----------
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

// ---------- Add Car ----------
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

    // Public URLs for the images (served by app.use('/uploads', ...))
    const images = (req.files || []).map(f => '/uploads/' + path.basename(f.path));

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

// ---------- Delete Car ----------
router.post('/cars/:id/delete', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (car && Array.isArray(car.images)) {
      car.images.forEach(imgUrl => {
        // imgUrl is like "/uploads/filename.jpg"
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

// ---------- Edit Car ----------
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

    // Required: price
    if (req.body.price === undefined || req.body.price === null || req.body.price === '') {
      return res.status(400).send('Price is required');
    }
    const parsedPrice = parseFloat(req.body.price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).send('Price must be a positive number');
    }
    car.price = parsedPrice;

    // Always allow description (can be empty string)
    car.description = (req.body.description ?? '').trim();

    // Helper to update only when a value was submitted
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

    await car.save();
    res.redirect('/admin/dashboard');
  } catch (error) {
    console.error('Error updating car:', error);
    res.status(500).send('Error updating car');
  }
});

module.exports = router;
