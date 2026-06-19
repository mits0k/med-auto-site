require('dotenv').config();                // <<< load .env FIRST

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { createTranslator } = require('./i18n');

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
app.use('/sitemap.xml', express.static(path.join(__dirname, 'sitemap.xml')));

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
  const requestedLanguage = ['en', 'fr'].includes(req.query.lang) ? req.query.lang : null;

  if (requestedLanguage && req.method === 'GET') {
    req.session.language = requestedLanguage;
    const params = new URLSearchParams(req.query);
    params.delete('lang');
    const destination = `${req.path}${params.toString() ? `?${params}` : ''}`;
    return req.session.save(() => res.redirect(303, destination));
  }

  const browserLanguage = String(req.headers['accept-language'] || '').toLowerCase();
  const publicLanguage = req.session.language || (browserLanguage.startsWith('fr') ? 'fr' : 'en');
  const isAdminPath = req.path.startsWith('/admin');
  const language = isAdminPath ? 'en' : publicLanguage;
  const queryFor = targetLanguage => {
    const params = new URLSearchParams(req.query);
    params.set('lang', targetLanguage);
    return `${req.path}?${params}`;
  };

  res.locals.session = req.session;
  res.locals.lang = language;
  res.locals.locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  res.locals.t = createTranslator(language);
  res.locals.showLanguageSwitch = !isAdminPath;
  res.locals.languageUrls = { en: queryFor('en'), fr: queryFor('fr') };
  req.language = language;
  req.t = res.locals.t;
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
