const GST_RATE = 0.05;
const QST_RATE = 0.09975;

function calculateQuebecTaxes(subtotalCents) {
  const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
  const gstCents = Math.round(subtotal * GST_RATE);
  const qstCents = Math.round(subtotal * QST_RATE);

  return {
    subtotalCents: subtotal,
    gstCents,
    qstCents,
    totalCents: subtotal + gstCents + qstCents
  };
}

module.exports = { calculateQuebecTaxes };
