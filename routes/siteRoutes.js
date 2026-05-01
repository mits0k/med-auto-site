// routes/siteRoutes.js
const express = require('express');
const router = express.Router();
const Car = require('../models/Car');
const Appointment = require('../models/Appointment');

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

// Inventory (filters + paging)
// By default: hide sold cars
// When showSold=true: show available + sold cars
router.get('/inventory', async (req, res) => {
  try {
    const perPage = 12;
    const page = parseInt(req.query.page) || 1;

    const { make, year, sort, showSold } = req.query;
    const filter = {};

    if (make && make !== 'all') filter.make = make;
    if (year && year !== 'all') filter.year = parseInt(year, 10);

    // Hide sold cars unless button is turned on
    if (showSold !== 'true') {
  filter.sold = { $ne: true };
}

    // Always keep available cars first and sold cars last
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
    const makes = await Car.distinct('make');
    const years = await Car.distinct('year');

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

/**
 * Book Appointment
 */
router.get('/book', async (req, res) => {
  try {
    const cars = await Car.find()
      .sort({ sold: 1, createdAt: -1 })
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

    const cars = await Car.find()
      .sort({ sold: 1, createdAt: -1 })
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
    const OPEN = 9 * 60;
    const CLOSE = 17 * 60 + 30;

    if (minutes < OPEN || minutes > CLOSE) {
      return res.render('book', {
        cars,
        selectedCarId: carId || '',
        minDate,
        success: false,
        error: 'Please choose a time between 9:00 AM and 5:30 PM.',
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
      chosenCar = await Car.findById(carId)
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

// Contact
router.get('/contact', (req, res) => {
  res.render('contact');
});

module.exports = router;