const path = require('path');
const express = require('express');
const https = require('https');
const { createTranslator } = require('./i18n');
const { calculateQuebecTaxes } = require('./utils/quebecTaxes');

require('dotenv').config();
const dodoPreviewTires = require('./data/dodo-preview-tires.json');

const app = express();
const root = __dirname;
const previewPartRequests = [];
let previewTireSalesEnabled = true;

app.set('views', path.join(root, 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use('/css', express.static(path.join(root, 'public/css')));
app.use('/images', express.static(path.join(root, 'public/images')));
app.use('/uploads', express.static(path.join(root, 'uploads')));
app.use('/js', express.static(path.join(root, 'public/js')));

app.use((req, res, next) => {
  const language = req.query.lang === 'fr' ? 'fr' : 'en';
  const queryFor = targetLanguage => {
    const params = new URLSearchParams(req.query);
    params.set('lang', targetLanguage);
    return `${req.path}?${params}`;
  };

  res.locals.t = createTranslator(language);
  res.locals.lang = language;
  res.locals.locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  res.locals.session = {};
  res.locals.showLanguageSwitch = !req.path.startsWith('/admin');
  res.locals.currentPath = req.path;
  res.locals.tireSalesEnabled = previewTireSalesEnabled;
  res.locals.languageUrls = { en: queryFor('en'), fr: queryFor('fr') };
  req.t = res.locals.t;
  next();
});

app.get('/', (req, res) => res.render('index', { featuredCar: null }));
app.get('/inventory', (req, res) => {
  res.render('inventory', {
    cars: [],
    currentPage: 1,
    totalPages: 0,
    makes: [],
    years: [],
    selectedMake: 'all',
    selectedYear: 'all',
    selectedSort: '',
    showSold: 'false'
  });
});
app.get('/contact', (req, res) => res.render('contact'));
app.get('/book', (req, res) => {
  res.render('book', {
    cars: [],
    selectedCarId: '',
    minDate: new Date().toISOString().slice(0, 10),
    success: false,
    error: null,
    name: '',
    email: '',
    phone: '',
    date: '',
    time: '',
    message: ''
  });
});
app.get('/trade-in', (req, res) => {
  res.render('trade-in', {
    success: false,
    error: null,
    formData: {}
  });
});

app.get('/admin/dashboard', (req, res) => {
  res.locals.session = { admin: true };
  res.render('admin/dashboard', {
    cars: [],
    tireSalesEnabled: previewTireSalesEnabled,
    tireSalesUpdate: req.query.tireSales || ''
  });
});

app.post('/admin/tire-sales/toggle', (req, res) => {
  previewTireSalesEnabled = req.body.enabled === 'true';
  res.redirect(`/admin/dashboard?tireSales=${previewTireSalesEnabled ? 'enabled' : 'paused'}`);
});

app.get('/admin/part-requests', (req, res) => {
  res.locals.session = { admin: true };
  res.render('admin/part-requests', {
    partRequests: previewPartRequests,
    updateStatus: req.query.updated || ''
  });
});

app.post('/admin/part-requests/:id/status', (req, res) => {
  const request = previewPartRequests.find(item => item._id === req.params.id);
  if (!request) return res.redirect('/admin/part-requests');
  request.status = 'Payment Received';
  request.paymentMethod = 'E-Transfer';
  request.paymentReceivedAt = new Date();
  request.customerNotifiedAt = new Date();
  res.redirect('/admin/part-requests?updated=received');
});

app.post('/admin/part-requests/:id/delete', (req, res) => {
  const index = previewPartRequests.findIndex(item => item._id === req.params.id);
  if (index >= 0) {
    previewPartRequests.splice(index, 1);
  }
  res.redirect('/admin/part-requests');
});

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

function stripeRequest({ method = 'POST', path: requestPath, params }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return Promise.reject(new Error('Missing STRIPE_SECRET_KEY'));
  }

  const body = params ? params.toString() : '';

  return new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname: 'api.stripe.com',
      path: requestPath,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      let responseBody = '';
      response.on('data', chunk => {
        responseBody += chunk;
      });
      response.on('end', () => {
        const payload = JSON.parse(responseBody || '{}');
        if (response.statusCode >= 400) {
          return reject(new Error(payload.error?.message || 'Stripe request failed'));
        }
        resolve(payload);
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function createStripeCheckoutSession({ req, tire, quantity, partRequest, returnTo }) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const safeReturnTo = String(returnTo || '/parts').startsWith('/parts') ? String(returnTo || '/parts') : '/parts';
  const separator = safeReturnTo.includes('?') ? '&' : '?';
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${origin}${safeReturnTo}${separator}request=reserved&partRequest=${partRequest._id}&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}${safeReturnTo}${separator}request=cancelled&partRequest=${partRequest._id}`);
  params.append('client_reference_id', String(partRequest._id));
  params.append('phone_number_collection[enabled]', 'true');
  params.append('line_items[0][quantity]', String(quantity));
  params.append('line_items[0][price_data][currency]', 'cad');
  params.append('line_items[0][price_data][unit_amount]', String(tire.priceCents));
  params.append('line_items[0][price_data][product_data][name]', `${tire.brand} ${tire.model}`);
  params.append('line_items[0][price_data][product_data][description]', `${tire.size} · ${tire.season}`);
  if (tire.imageUrl) {
    params.append('line_items[0][price_data][product_data][images][0]', tire.imageUrl);
  }
  params.append('metadata[partRequestId]', String(partRequest._id));
  params.append('metadata[tireId]', tire.id);
  params.append('payment_intent_data[capture_method]', 'manual');
  params.append('payment_intent_data[metadata][partRequestId]', String(partRequest._id));
  params.append('payment_intent_data[metadata][tireId]', tire.id);

  return stripeRequest({
    method: 'POST',
    path: '/v1/checkout/sessions',
    params
  });
}

function retrieveStripeCheckoutSession(sessionId) {
  return stripeRequest({
    method: 'GET',
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`
  });
}

function captureStripePaymentIntent(paymentIntentId) {
  return stripeRequest({
    method: 'POST',
    path: `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`,
    params: new URLSearchParams()
  });
}

function cancelStripePaymentIntent(paymentIntentId) {
  return stripeRequest({
    method: 'POST',
    path: `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
    params: new URLSearchParams()
  });
}

app.get('/parts', async (req, res) => {
  if (!previewTireSalesEnabled) {
    return res.status(503).render('parts-paused');
  }

  const { partsCategories, tireSizes, tireSeasons, tires } = getPartsCatalog();

  if (req.query.request === 'reserved' && req.query.partRequest && req.query.session_id) {
    try {
      const session = await retrieveStripeCheckoutSession(req.query.session_id);
      const request = previewPartRequests.find(item => item._id === req.query.partRequest);

      if (request) {
        request.stripeCheckoutSessionId = session.id;
        request.stripePaymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || '';
        request.customerName = session.customer_details?.name || request.customerName;
        request.customerEmail = session.customer_details?.email || request.customerEmail;
        request.customerPhone = session.customer_details?.phone || request.customerPhone;
      }
    } catch (err) {
      console.error('Stripe preview session sync error:', err.message);
    }
  }

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

app.get('/parts/checkout', (req, res) => {
  if (!previewTireSalesEnabled) {
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

app.get('/parts/order-confirmation', (req, res) => {
  const request = previewPartRequests.find(item => item._id === req.query.order);
  if (!request) return res.redirect('/parts');
  const { tires } = getPartsCatalog();
  const tire = tires.find(item => item.id === request.supplierProductId);
  res.render('parts-order-confirmation', {
    tire,
    quantity: request.quantity,
    orderId: request._id,
    totalCents: calculateQuebecTaxes(request.priceCents * request.quantity).totalCents,
    etransferEmail: process.env.ETRANSFER_EMAIL || 'tkalantzis70@gmail.com'
  });
});

app.post('/parts/request', async (req, res) => {
  if (!previewTireSalesEnabled) {
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

    if (!customerName || !customerPhone || !customerEmail) {
      return res.status(400).render('parts-checkout', {
        tire,
        quantity,
        error: req.t('Please enter your name, email and phone number.'),
        form: req.body,
        etransferEmail: process.env.ETRANSFER_EMAIL || 'tkalantzis70@gmail.com'
      });
    }

    const partRequest = {
      _id: `preview-${Date.now()}`,
      supplierProductId: tire.id,
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
      note: req.body.note || '',
      status: 'Awaiting E-Transfer',
      paymentMethod: 'E-Transfer',
      createdAt: new Date()
    };
    previewPartRequests.unshift(partRequest);

    res.redirect(303, `/parts/order-confirmation?order=${encodeURIComponent(partRequest._id)}`);
  } catch (err) {
    console.error('Tire request preview error:', err.message);
    res.redirect('/parts?request=error');
  }
});

const port = process.env.PARTS_PREVIEW_PORT || 3012;
app.listen(port, '127.0.0.1', () => {
  console.log(`Parts preview running at http://localhost:${port}/parts`);
});

// Keep the standalone local preview available while it is open in Codex.
setInterval(() => {}, 60 * 60 * 1000);
