const express = require('express');
const router = express.Router();
const Car = require('../models/Car');
const Appointment = require('../models/Appointment');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer for add-car only
const storage = multer.diskStorage({
  destination(req, file, cb) { cb(null, 'uploads'); },
  filename(req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname).toLowerCase());
  },
});
const upload = multer({
  storage,
  fileFilter(req, file, cb) {
    const allowed = ['.jpg','.jpeg','.png','.gif','.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'));
    cb(null, true);
  },
});

// very simple admin guard
function isAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

router.get('/', (req, res) => res.redirect('/admin/login'));

// Auth
router.get('/login', (req, res) => res.render('admin/login', { error: null }));
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === '1234') {
    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { error: 'Invalid credentials' });
});

// Dashboard
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const cars = await Car.find().sort({ createdAt: -1 });
    res.render('admin/dashboard', { cars });
  } catch {
    res.status(500).send('Server error');
  }
});

// Appointments
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

// Add Car (GET)
router.get('/add-car', isAdmin, (req, res) => {
  res.render('admin/add-car', { error: null });
});

// Add Car (POST) — now captures spec fields
router.post('/add-car', isAdmin, upload.array('images', 20), async (req, res) => {
  try {
    const {
      make, model, year, price, description,
      exteriorColor, interiorColor, mileage,
      engine, transmission, drivetrain, fuel, bodyStyle, vin
    } = req.body;

    const images = (req.files || []).map(f => '/uploads/' + f.filename);

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

// Delete Car
router.post('/cars/:id/delete', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (car && car.images) {
      car.images.forEach(img => {
        const p = path.join(__dirname, '..', img);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
    }
    await Car.findByIdAndDelete(req.params.id);
    res.redirect('/admin/dashboard');
  } catch {
    res.status(500).send('Error deleting car');
  }
});

// Edit Car (GET) — allow editing specs too
router.get('/cars/:id/edit', isAdmin, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).send('Car not found');
    res.render('admin/edit-car', { car, error: null });
  } catch {
    res.status(500).send('Server error');
  }
});

// Edit Car (POST) — only change fields that were submitted (don't blank others)
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

    // Always allow description (can be empty string if you want)
    car.description = (req.body.description ?? '').trim();

    // Helper to update only when a value was submitted
    const setIfProvided = (key, transform = v => v) => {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const val = req.body[key];
        if (val !== '' && val !== null && val !== undefined) {
          car[key] = transform(val);
        }
        // If you want to allow clearing a field when user sends empty string,
        // replace the block above with: car[key] = val === '' ? undefined : transform(val);
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
