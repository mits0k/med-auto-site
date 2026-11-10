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
const PartRequest = require('../models/PartRequest');
const dodoPreviewTires = require('../data/dodo-preview-tires.json');
const { calculateQuebecTaxes } = require('../utils/quebecTaxes');

const displaySort = {
  sold: 1,
  displayOrder: 1,
  createdAt: -1
};

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
      return cb(new Error(req.t ? req.t('Only image files are allowed') : 'Only image files are allowed'));
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

const partsCategories = [
  { id: 'tires', label: 'Tires', status: 'Available now' }
];

function getPartsCatalog() {
  const tireSizes = [...new Set(dodoPreviewTires.map(tire => tire.size))]
    .filter(Boolean)
    .sort();
  const tireSeasons = [...new Set(dodoPreviewTires.map(tire => tire.season))]
    .filter(Boolean)
    .sort();

  return {
    partsCategories,
    tireSizes,
    tireSeasons,
    tires: dodoPreviewTires
  };
}

// Home
router.get('/', async (req, res) => {
  try {
    let featuredCar = await Car.findOne({
      isFeatured: true,
      sold: { $ne: true }
    }).sort(displaySort).lean();

    if (!featuredCar) {
      featuredCar = await Car.findOne({ sold: { $ne: true } })
        .sort(displaySort)
        .lean();
    }

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

    let sortOption = displaySort;

    if (sort === 'price-asc') {
      sortOption = { sold: 1, price: 1, displayOrder: 1, createdAt: -1 };
    } else if (sort === 'price-desc') {
      sortOption = { sold: 1, price: -1, displayOrder: 1, createdAt: -1 };
    } else if (sort === 'year-asc') {
      sortOption = { sold: 1, year: 1, displayOrder: 1, createdAt: -1 };
    } else if (sort === 'year-desc') {
      sortOption = { sold: 1, year: -1, displayOrder: 1, createdAt: -1 };
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
    res.send(req.t('Error loading cars'));
  }
});

// Parts
router.get('/parts', async (req, res) => {
  if (res.locals.tireSalesEnabled === false) {
    return res.status(503).render('parts-paused');
  }

  const { partsCategories, tireSizes, tireSeasons, tires } = getPartsCatalog();

  res.render('parts', {
    partsCategories,
    tires,
    tireSizes,
    tireSeasons,
    selectedCategory: req.query.category || 'tires',
    selectedSizeSearch: String(req.query.size || '').trim(),
    selectedSeason: req.query.season || 'all',
    paymentStatus: req.query.payment || '',
    requestStatus: req.query.request || ''
  });
});

router.get('/parts/checkout', (req, res) => {
  if (res.locals.tireSalesEnabled === false) {
    return res.status(503).render('parts-paused');
  }

  const { tires } = getPartsCatalog();
  const tire = tires.find(item => item.id === req.query.tireId);

  if (!tire) return res.redirect('/parts?request=missing-item');
  const quantity = Math.max(1, Math.min(8, Number(tire.stockQuantity || 8), Number(req.query.quantity || 4)));

  res.render('parts-checkout', {
    tire,
    quantity,
    error: null,
    form: {},
    etransferEmail: process.env.ETRANSFER_EMAIL || 'tkalantzis70@gmail.com'
  });
});

router.get('/parts/order-confirmation', (req, res) => {
  const confirmation = req.session.partOrderConfirmation;
  if (!confirmation) return res.redirect('/parts');

  delete req.session.partOrderConfirmation;
  res.render('parts-order-confirmation', confirmation);
});

router.post('/parts/request', async (req, res) => {
  if (res.locals.tireSalesEnabled === false) {
    return res.status(503).render('parts-paused');
  }

  try {
    const { tires } = getPartsCatalog();
    const tire = tires.find(item => item.id === req.body.tireId);
    const requestedQuantity = Math.max(1, Math.min(8, Number(req.body.quantity || 4)));
    if (!tire) {
      return res.redirect('/parts?request=missing-item');
    }
    const quantity = Math.min(requestedQuantity, Number(tire.stockQuantity || 8));

    const customerName = String(req.body.customerName || '').trim();
    const customerPhone = String(req.body.customerPhone || '').trim();
    const customerEmail = String(req.body.customerEmail || '').trim();
    const note = String(req.body.note || '').trim();

    if (!customerName || !customerPhone || !customerEmail) {
      return res.status(400).render('parts-checkout', {
        tire,
        quantity,
        error: req.t('Please enter your name, email and phone number.'),
        form: req.body,
        etransferEmail: process.env.ETRANSFER_EMAIL || 'tkalantzis70@gmail.com'
      });
    }

    const partRequest = await new PartRequest({
      supplierProductId: tire.productId,
      supplierUrl: tire.sourceUrl,
      brand: tire.brand,
      model: tire.model,
      size: tire.size,
      season: tire.season,
      quantity,
      priceCents: tire.priceCents,
      customerName,
      customerPhone,
      customerEmail,
      note
    }).save();

    const taxSummary = calculateQuebecTaxes(Number(tire.priceCents || 0) * quantity);

    if (resend && process.env.BOOKING_EMAIL_TO) {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'MED AUTO <onboarding@resend.dev>',
        to: process.env.BOOKING_EMAIL_TO,
        subject: `New tire request - ${tire.size} ${tire.brand}`,
        text: [
          'New tire e-transfer order',
          '',
          `Request ID: ${partRequest._id}`,
          `Tire: ${tire.brand} ${tire.model}`,
          `Size: ${tire.size}`,
          `Season: ${tire.season}`,
          `Quantity: ${quantity}`,
          `MED price each: $${(Number(tire.priceCents || 0) / 100).toFixed(2)}`,
          `Subtotal: $${(taxSummary.subtotalCents / 100).toFixed(2)}`,
          `GST: $${(taxSummary.gstCents / 100).toFixed(2)}`,
          `QST: $${(taxSummary.qstCents / 100).toFixed(2)}`,
          `E-transfer total: $${(taxSummary.totalCents / 100).toFixed(2)}`,
          `Dodo link: ${tire.sourceUrl || ''}`,
          '',
          `Customer: ${customerName}`,
          `Phone: ${customerPhone}`,
          `Email: ${customerEmail || 'Not provided'}`,
          `Note: ${note || 'None'}`,
          '',
          'Next step: verify the e-transfer, then click Payment Received in admin.'
        ].join('\n')
      });
    }

    req.session.partOrderConfirmation = {
      tire: {
        brand: String(tire.brand || ''),
        model: String(tire.model || ''),
        size: String(tire.size || ''),
        priceCents: Number(tire.priceCents || 0)
      },
      quantity,
      orderId: String(partRequest._id),
      totalCents: taxSummary.totalCents,
      etransferEmail: process.env.ETRANSFER_EMAIL || 'tkalantzis70@gmail.com'
    };
    res.redirect(303, '/parts/order-confirmation');
  } catch (err) {
    console.error('Tire request error:', err.message);
    res.redirect('/parts?request=error');
  }
});

// Car details
router.get('/inventory/:id', async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).send(req.t('Car not found'));
    res.render('car-details', { car });
  } catch (err) {
    res.status(500).send(req.t('Server error'));
  }
});

// Book Appointment
router.get('/book', async (req, res) => {
  try {
    const cars = await Car.find({ sold: { $ne: true } })
      .sort(displaySort)
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
    res.status(500).send(req.t('Server error'));
  }
});

router.post('/book', async (req, res) => {
  try {
    const { name, email, phone, date, time, message, carId } = req.body;

    const cars = await Car.find({ sold: { $ne: true } })
      .sort(displaySort)
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
        error: req.t('Please fill in your name, email, phone, date and time.'),
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
        error: req.t('Invalid date or time.'),
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
        error: req.t('We are closed on Sundays. Please choose another day.'),
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
        error: req.t('Please choose a time in the future.'),
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
        error: req.t('Please choose a time between 10:00 AM and 5:30 PM.'),
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
        error: req.t('Please choose one of the available appointment times.'),
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
      error: req.t('Error booking appointment. Please try again.'),
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
        error: req.t('Please fill in all required fields.'),
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
      error: req.t('Something went wrong. Please try again.'),
      formData: req.body || {}
    });
  }
});

// Contact
router.get('/contact', (req, res) => {
  res.render('contact');
});

module.exports = router;
