require('dotenv').config();                // <<< load .env FIRST

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const siteRoutes = require('./routes/siteRoutes');
const adminRoutes = require('./routes/adminRoutes');


const app = express();

/* === Ensure /uploads exists (important for first boot on Render) === */
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

/* === Middleware & static === */
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // serves /css, /js, /images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* === Views === */
app.set('view engine', 'ejs');

app.set('trust proxy', 1);

/* === Sessions === */
app.use(session({
  secret: process.env.SESSION_SECRET || 'adminSecret123',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' // set true when behind HTTPS
  }
}));


app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

/* === DB === */
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));

/* === Routes === */
app.use('/', siteRoutes);
app.use('/admin', adminRoutes);
