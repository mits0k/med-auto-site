// routes/siteRoutes.js
const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

const Car = require('../models/Car');
const Appointment = require('../models/Appointment');
const TradeIn = require('../models/TradeIn');

let resend = null;

if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}

// Upload setup for trade-in photos
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!allowed.includes(ext)) {
      return cb(new Error('Only image files are allowed'));
    }

    cb(null, true);
  },
  limits: {
    files: 10,
    fileSize: 20 * 1024 * 1024
  }
});

async function processAndSaveTradeImage(fileBuffer) {
  const base = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const outPath = path.join(uploadDir, `${base}.webp`);
  const publicUrl = `/uploads/${path.basename(outPath)}`;

  await sharp(fileBuffer)
    .rotate()
    .resize({
      width: 1280,
      withoutEnlargement: true
    })
    .webp({
      quality: 58,
      effort: 3
    })
    .toFile(outPath);

  return publicUrl;
}

// Home
router.get('/', async (req, res) => {
  try {
    const featuredCar = await Car.findOne().sort({ _id: -1 }).lean();
    res.render('index', { featuredCar: featuredCar || null });
  } catch (e) {
    console.error('Error loading featured car:', e);
    res.render('index', { featuredCar: null });
  }
});

// Inventory
router.get('/inventory', async (req, res) => {
  try {
    const perPage = 12;
    const page = parseInt(req.query.page) || 1;

    const { make, year, sort, showSold } = req.query;
    const filter = {};

    if (make && make !== 'all') filter.make = make;
    if (year && year !== 'all') filter.year = parseInt(year, 10);

    if (showSold === 'true') {
      filter.sold = true;
    } else {
      filter.sold = { $ne: true };
    }

    let sortOption = { sold: 1 };

    if (sort === 'price-asc') {
      sortOption.price = 1;
    } else if (sort === 'price-desc') {
      sortOption.price = -1;
    } else if (sort === 'year-asc') {
      sortOption.year = 1;
    } else if (sort === 'year-desc') {
      sortOption.year = -1;
    } else {
      sortOption.createdAt = -1;
    }

    const totalCars = await Car.countDocuments(filter);

    const cars = await Car.find(filter)
      .sort(sortOption)
      .skip((page - 1) * perPage)
      .limit(perPage);

    const totalPages = Math.ceil(totalCars / perPage);
    const availableFilter = { sold: { $ne: true } };

    const makes = await Car.distinct('make', availableFilter);
    const years = await Car.distinct('year', availableFilter);

    res.render('inventory', {
      cars,
      currentPage: page,
      totalPages,
      makes,
      years,
      selectedMake: make || 'all',
      selectedYear: year || 'all',
      selectedSort: sort || '',
      showSold: showSold === 'true' ? 'true' : 'false',
    });
  } catch (err) {
    console.error(err);
    res.send('Error loading cars');
  }
});

// Car details
router.get('/inventory/:id', async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).send('Car not found');
    res.render('car-details', { car });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// Book Appointment
router.get('/book', async (req, res) => {
  try {
    const cars = await Car.find({ sold: { $ne: true } })
      .sort({ createdAt: -1 })
      .select('_id make model year')
      .lean();

    const selectedCarId = req.query.car || '';

    const today = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const minDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    res.render('book', {
      cars,
      selectedCarId,
      minDate,
      success: false,
      error: null,
      name: '',
      email: '',
      phone: '',
      date: '',
      time: '',
      message: '',
    });
  } catch (e) {
    console.error('Error loading booking page:', e);
    res.status(500).send('Server error');
  }
});

router.post('/book', async (req, res) => {
  try {
    const { name, email, phone, date, time, message, carId } = req.body;

    const cars = await Car.find({ sold: { $ne: true } })
      .sort({ createdAt: -1 })
      .select('_id make model year')
      .lean();

    const today = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    const minDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    if (!name || !email || !phone || !date || !time) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: 'Please fill in your name, email, phone, date and time.',
        name,
        email,
        phone,
        date,
        time,
        message
      });
    }

    const combined = new Date(`${date}T${time}:00`);

    if (isNaN(combined.getTime())) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: 'Invalid date or time.',
        name,
        email,
        phone,
        date,
        time,
        message
      });
    }

    if (combined.getDay() === 0) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: "We're closed on Sundays. Please choose another day.",
        name,
        email,
        phone,
        date: '',
        time,
        message
      });
    }

    const now = new Date();

    if (combined < now) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: 'Please choose a time in the future.',
        name,
        email,
        phone,
        date,
        time,
        message
      });
    }

    const [hStr, mStr] = time.split(':');
    const minutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
    const OPEN = 10 * 60;
    const CLOSE = 17 * 60 + 30;

    if (minutes < OPEN || minutes > CLOSE) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: 'Please choose a time between 10:00 AM and 5:30 PM.',
        name,
        email,
        phone,
        date,
        time,
        message
      });
    }

    if (minutes % 15 !== 0) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: 'Please choose one of the available appointment times.',
        name,
        email,
        phone,
        date,
        time,
        message
      });
    }

    let chosenCar = null;
    let carLabel = null;

    if (carId) {
      chosenCar = await Car.findOne({
        _id: carId,
        sold: { $ne: true }
      })
        .select('_id make model year')
        .lean();

      if (chosenCar) {
        carLabel = `${chosenCar.year} ${chosenCar.make} ${chosenCar.model}`;
      }
    }

    await new Appointment({
      name,
      email,
      phone,
      date: combined,
      message: (message || '').trim(),
      car: chosenCar ? chosenCar._id : undefined,
      carLabel: carLabel || undefined
    }).save();

    try {
      if (resend && process.env.BOOKING_EMAIL_TO) {
        await resend.emails.send({
          from: 'MED AUTO <onboarding@resend.dev>',
          to: process.env.BOOKING_EMAIL_TO,
          subject: 'New Appointment Booking - MED AUTO',
          text: `
New appointment booking:

Name: ${name}
Email: ${email}
Phone: ${phone}
Car: ${carLabel || 'No car selected'}
Date & Time: ${combined.toLocaleString()}
Message: ${message || 'No message'}
          `
        });

        console.log('Booking email sent');
      }
    } catch (emailError) {
      console.error('Email notification failed:', emailError);
    }

    res.render('book', {
      cars,
      selectedCarId: '',
      minDate,
      success: true,
      error: null,
      name: '',
      email: '',
      phone: '',
      date: '',
      time: '',
      message: ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('book', {
      cars: [],
      selectedCarId: '',
      minDate: '',
      success: false,
      error: 'Error booking appointment. Please try again.',
      ...req.body
    });
  }
});

// Trade-In Page
router.get('/trade-in', (req, res) => {
  res.render('trade-in', {
    success: false,
    error: null,
    formData: {}
  });
});

router.post('/trade-in', upload.array('images', 10), async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      year,
      make,
      model,
      mileage,
      vin,
      condition,
      askingPrice,
      message
    } = req.body;

    const formData = req.body;

    if (!name || !phone || !year || !make || !model || !mileage) {
      return res.render('trade-in', {
        success: false,
        error: 'Please fill in all required fields.',
        formData
      });
    }

    let images = [];

    if (Array.isArray(req.files) && req.files.length > 0) {
      images = await Promise.all(
        req.files.map(file => processAndSaveTradeImage(file.buffer))
      );
    }

    await new TradeIn({
      name: String(name).trim(),
      email: String(email || '').trim(),
      phone: String(phone).trim(),
      year: parseInt(year, 10),
      make: String(make).trim(),
      model: String(model).trim(),
      mileage: parseInt(mileage, 10),
      vin: String(vin || '').trim(),
      condition: String(condition || '').trim(),
      askingPrice: askingPrice ? parseFloat(askingPrice) : undefined,
      message: String(message || '').trim(),
      images
    }).save();

    try {
      if (resend && process.env.BOOKING_EMAIL_TO) {
        await resend.emails.send({
          from: 'MED AUTO <onboarding@resend.dev>',
          to: process.env.BOOKING_EMAIL_TO,
          subject: 'New Trade-In Request - MED AUTO',
          text: `
New trade-in request:

Customer:
${name}
${phone}
${email || 'No email'}

Vehicle:
${year} ${make} ${model}

Mileage:
${mileage} km

VIN:
${vin || 'N/A'}

Condition:
${condition || 'N/A'}

Asking Price:
${askingPrice || 'N/A'}

Photos:
${images.length ? `${images.length} photo(s) uploaded. Check the admin dashboard.` : 'No photos uploaded'}

Message:
${message || 'No message'}
          `
        });

        console.log('Trade-in email sent');
      }
    } catch (emailErr) {
      console.error('Trade-in email failed:', emailErr);
    }

    res.render('trade-in', {
      success: true,
      error: null,
      formData: {}
    });
  } catch (err) {
    console.error(err);

    res.render('trade-in', {
      success: false,
      error: 'Something went wrong. Please try again.',
      formData: req.body || {}
    });
  }
});

// Contact
router.get('/contact', (req, res) => {
  res.render('contact');
});

module.exports = router;