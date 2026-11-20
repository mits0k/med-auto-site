const https = require('https');

function stripeRequest({ method = 'POST', path, params }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Stripe payments are not configured');

  const body = params ? params.toString() : '';
  return new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname: 'api.stripe.com',
      path,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      let responseBody = '';
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(responseBody || '{}');
        } catch {
          return reject(new Error('Stripe returned an unreadable response'));
        }
        if (response.statusCode >= 400) {
          return reject(new Error(payload.error?.message || 'Stripe request failed'));
        }
        resolve(payload);
      });
    });

    request.on('error', reject);
    request.end(body);
  });
}

function createTireCheckoutSession({ req, tire, quantity, partRequest, totalCents }) {
  const origin = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('payment_method_types[0]', 'card');
  params.append('success_url', `${origin}/parts/payment-return?request=${partRequest._id}&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}/parts/payment-cancel?request=${partRequest._id}`);
  params.append('client_reference_id', String(partRequest._id));
  params.append('customer_email', partRequest.customerEmail);
  params.append('phone_number_collection[enabled]', 'true');
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', 'cad');
  params.append('line_items[0][price_data][unit_amount]', String(totalCents));
  params.append('line_items[0][price_data][product_data][name]', `${quantity} × ${tire.brand} ${tire.model} tires`);
  params.append('line_items[0][price_data][product_data][description]', `${tire.size} · ${tire.season} · GST/QST included · pickup at MED AUTO`);
  if (tire.imageUrl) params.append('line_items[0][price_data][product_data][images][0]', tire.imageUrl);
  params.append('metadata[partRequestId]', String(partRequest._id));
  params.append('metadata[tireId]', tire.id);
  params.append('payment_intent_data[capture_method]', 'manual');
  params.append('payment_intent_data[metadata][partRequestId]', String(partRequest._id));
  params.append('payment_intent_data[metadata][tireId]', tire.id);

  return stripeRequest({ path: '/v1/checkout/sessions', params });
}

function retrieveCheckoutSession(sessionId) {
  return stripeRequest({
    method: 'GET',
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`
  });
}

function capturePaymentIntent(paymentIntentId) {
  return stripeRequest({
    path: `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`,
    params: new URLSearchParams()
  });
}

function cancelPaymentIntent(paymentIntentId) {
  return stripeRequest({
    path: `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
    params: new URLSearchParams()
  });
}

module.exports = {
  createTireCheckoutSession,
  retrieveCheckoutSession,
  capturePaymentIntent,
  cancelPaymentIntent
};
