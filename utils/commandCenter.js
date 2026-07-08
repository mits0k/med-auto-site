const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LEAD_SOURCES = [
  'CarGurus',
  'Facebook Marketplace',
  'MED Auto website',
  'Kijiji',
  'AutoTrader',
  'phone call',
  'walk-in',
  'referral',
  'other'
];

const LEAD_STAGES = [
  'New Lead',
  'Contacted',
  'Qualified',
  'Appointment Set',
  'Showed Up',
  'Test Drive',
  'Offer Made',
  'Sold',
  'Lost',
  'No Show'
];

const ACTION_GROUPS = [
  'Close Active Buyer',
  'Hold',
  'Follow Up Leads',
  'Refresh Listing',
  'Price Review',
  'Urgent Aging Review',
  'Wholesale Review'
];

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function daysBetween(start, end = new Date()) {
  if (!start) return 0;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((end - date) / MS_PER_DAY));
}

function isThisMonth(date, now = new Date()) {
  if (!date) return false;
  const value = new Date(date);
  return value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth();
}

function getReconTotal(car) {
  return (car.reconExpenses || []).reduce((sum, item) => sum + toNumber(item.amount), 0);
}

function getTotalInvested(car) {
  return toNumber(car.purchaseCost) +
    toNumber(car.auctionFees) +
    toNumber(car.transportCost) +
    toNumber(car.inspectionCost) +
    getReconTotal(car);
}

function getPotentialGross(car) {
  return toNumber(car.price) - getTotalInvested(car);
}

function getSoldGross(car) {
  return toNumber(car.finalSalePrice) - getTotalInvested(car);
}

function getRoi(gross, invested) {
  return invested > 0 ? gross / invested : 0;
}

function getDaysInStock(car) {
  return daysBetween(car.purchaseDate || car.createdAt);
}

function getVehicleLabel(car) {
  return [car.year, car.make, car.model, car.trim].filter(Boolean).join(' ');
}

function countLeadStages(car) {
  const leads = car.leads || [];
  return {
    total: leads.length,
    active: leads.filter(lead => !['Sold', 'Lost', 'No Show'].includes(lead.stage)).length,
    appointments: leads.filter(lead => lead.stage === 'Appointment Set').length,
    showUps: leads.filter(lead => ['Showed Up', 'Test Drive', 'Offer Made', 'Sold'].includes(lead.stage)).length,
    testDrives: leads.filter(lead => ['Test Drive', 'Offer Made', 'Sold'].includes(lead.stage)).length,
    offers: leads.filter(lead => ['Offer Made', 'Sold'].includes(lead.stage)).length,
    sales: leads.filter(lead => lead.stage === 'Sold').length
  };
}

function hasUpcomingAppointment(car, appointmentsByCar = {}) {
  return toNumber(appointmentsByCar[String(car._id)]) > 0;
}

function hasActiveBuyer(car, appointmentsByCar = {}) {
  const activeStatus = String(car.activeBuyerStatus || '').toLowerCase();
  return activeStatus.includes('active') ||
    activeStatus.includes('appointment') ||
    activeStatus.includes('saturday') ||
    hasUpcomingAppointment(car, appointmentsByCar);
}

function getRecommendation(car, appointmentsByCar = {}) {
  const days = getDaysInStock(car);
  const saves = toNumber(car.cargurus?.saves);
  const imv = toNumber(car.cargurus?.imv);
  const asking = toNumber(car.price);
  const leadCounts = countLeadStages(car);
  const leadConversionPoor = saves >= 5 && leadCounts.total <= 1;
  const belowMarket = imv > 0 && asking > 0 && asking <= imv * 0.96;
  const strongEngagement = saves >= 3 || leadCounts.total >= 2;
  const activeBuyer = hasActiveBuyer(car, appointmentsByCar);
  let action = 'HOLD';
  let why = 'Fresh unit or still within the normal retail window.';
  let nextStep = 'Protect margin and keep the listing clean.';
  let group = 'Hold';
  let targetPrice = asking || null;

  if (activeBuyer) {
    action = 'HOLD - ACTIVE LEAD';
    why = 'There is an active buyer note or upcoming appointment.';
    nextStep = 'Close the buyer before changing price.';
    group = 'Close Active Buyer';
  } else if (days >= 60) {
    action = 'URGENT REVIEW';
    why = 'Vehicle is over 60 days in stock.';
    nextStep = 'Decide whether to retail hard this week, reduce, or wholesale.';
    group = getTotalInvested(car) > asking ? 'Wholesale Review' : 'Urgent Aging Review';
    targetPrice = asking ? Math.round((asking * 0.97) / 100) * 100 : null;
  } else if (days >= 45 && saves === 0 && leadCounts.total === 0) {
    action = 'REFRESH LISTING';
    why = 'Vehicle is 45+ days old with no saves or leads.';
    nextStep = 'Refresh first photo, title, description, and review market position.';
    group = 'Refresh Listing';
    targetPrice = asking ? Math.round((asking * 0.98) / 100) * 100 : null;
  } else if (leadConversionPoor) {
    action = 'FOLLOW UP LEADS';
    why = 'Saves are building but buyer conversion is weak.';
    nextStep = 'Contact warm leads and improve response/listing conversion.';
    group = 'Follow Up Leads';
  } else if (days >= 30 && days <= 44 && (saves >= 3 || leadCounts.total > 0)) {
    action = 'FOLLOW UP LEADS';
    why = '30-44 days in stock with visible buyer interest.';
    nextStep = 'Convert interest before cutting the price.';
    group = 'Follow Up Leads';
  } else if (belowMarket && strongEngagement) {
    action = 'CONSIDER PRICE INCREASE';
    why = 'Asking price is below IMV and engagement is strong.';
    nextStep = 'Hold current price or test a modest increase after checking active leads.';
    group = 'Price Review';
    targetPrice = imv ? Math.round((Math.min(imv, asking * 1.03)) / 100) * 100 : targetPrice;
  } else if (imv > 0 && asking > imv * 1.08 && days >= 30) {
    action = 'MARKET REVIEW';
    why = 'Asking price is materially above IMV after 30+ days.';
    nextStep = 'Compare local comps and consider a price correction.';
    group = 'Price Review';
    targetPrice = Math.round((imv * 1.02) / 100) * 100;
  }

  return { action, why, nextStep, targetPrice, group };
}

function getVehicleMetrics(car, appointmentsByCar = {}) {
  const reconTotal = getReconTotal(car);
  const totalInvested = getTotalInvested(car);
  const potentialGross = getPotentialGross(car);
  const soldGross = getSoldGross(car);
  const roi = getRoi(potentialGross, totalInvested);
  const soldRoi = getRoi(soldGross, totalInvested);
  const leadCounts = countLeadStages(car);
  const recommendation = getRecommendation(car, appointmentsByCar);

  return {
    label: getVehicleLabel(car),
    reconTotal,
    totalInvested,
    potentialGross,
    roi,
    soldGross,
    soldRoi,
    daysInStock: getDaysInStock(car),
    leadCounts,
    appointments: toNumber(appointmentsByCar[String(car._id)]) + leadCounts.appointments,
    recommendation,
    capitalPerDay: getDaysInStock(car) > 0 ? totalInvested / getDaysInStock(car) : totalInvested
  };
}

function getBuyingScorecardMetrics(scorecard) {
  const allInCost = toNumber(scorecard.proposedPurchasePrice) +
    toNumber(scorecard.auctionFees) +
    toNumber(scorecard.transport) +
    toNumber(scorecard.estimatedRecon);
  const expectedGross = toNumber(scorecard.expectedRetail) - allInCost;
  const expectedRoi = getRoi(expectedGross, allInCost);
  const expectedDays = Math.max(1, toNumber(scorecard.expectedDaysToSell) || 45);
  const expectedGrossPerDay = expectedGross / expectedDays;
  const capitalEfficiencyScore = expectedRoi * (45 / expectedDays) * 100;
  let decision = 'Review Carefully';

  if (expectedGross < 1500 || expectedRoi < 0.12) {
    decision = expectedGross <= 0 ? 'Pass' : 'Renegotiate';
  } else if (capitalEfficiencyScore >= 28 && expectedGross >= 2500) {
    decision = 'Strong Buy';
  } else if (capitalEfficiencyScore >= 18 && expectedGross >= 2000) {
    decision = 'Good Buy';
  }

  return {
    allInCost,
    expectedGross,
    expectedRoi,
    expectedGrossPerDay,
    capitalEfficiencyScore,
    decision
  };
}

function buildDashboard(cars, appointments = []) {
  const now = new Date();
  const appointmentsByCar = {};
  appointments.forEach(appointment => {
    if (!appointment.car) return;
    const key = String(appointment.car);
    appointmentsByCar[key] = (appointmentsByCar[key] || 0) + 1;
  });

  const rows = cars.map(car => ({
    car,
    metrics: getVehicleMetrics(car, appointmentsByCar)
  }));
  const activeRows = rows.filter(row => !row.car.sold);
  const soldThisMonth = rows.filter(row => row.car.sold && isThisMonth(row.car.saleDate || row.car.updatedAt, now));
  const leadsThisMonth = rows.reduce((sum, row) => {
    return sum + (row.car.leads || []).filter(lead => isThisMonth(lead.date, now)).length;
  }, 0);
  const appointmentsThisMonth = appointments.filter(appointment => isThisMonth(appointment.date, now)).length;
  const salesThisMonth = soldThisMonth.length + rows.reduce((sum, row) => {
    return sum + (row.car.leads || []).filter(lead => lead.stage === 'Sold' && isThisMonth(lead.date, now)).length;
  }, 0);
  const totalInvested = activeRows.reduce((sum, row) => sum + row.metrics.totalInvested, 0);
  const totalAsking = activeRows.reduce((sum, row) => sum + toNumber(row.car.price), 0);
  const potentialGross = activeRows.reduce((sum, row) => sum + row.metrics.potentialGross, 0);
  const roiRows = activeRows.filter(row => row.metrics.totalInvested > 0);
  const avgRoi = roiRows.length
    ? roiRows.reduce((sum, row) => sum + row.metrics.roi, 0) / roiRows.length
    : 0;
  const avgDays = activeRows.length
    ? activeRows.reduce((sum, row) => sum + row.metrics.daysInStock, 0) / activeRows.length
    : 0;

  return {
    appointmentsByCar,
    rows,
    kpis: {
      totalVehicles: cars.length,
      capitalTiedUp: totalInvested,
      totalAskingValue: totalAsking,
      potentialGross,
      averageRoi: avgRoi,
      averageDaysInStock: avgDays,
      over30: activeRows.filter(row => row.metrics.daysInStock >= 30).length,
      over45: activeRows.filter(row => row.metrics.daysInStock >= 45).length,
      over60: activeRows.filter(row => row.metrics.daysInStock >= 60).length,
      leadsThisMonth,
      appointmentsThisMonth,
      salesThisMonth,
      leadToSaleConversion: leadsThisMonth > 0 ? salesThisMonth / leadsThisMonth : 0
    }
  };
}

module.exports = {
  ACTION_GROUPS,
  LEAD_SOURCES,
  LEAD_STAGES,
  buildDashboard,
  getBuyingScorecardMetrics,
  getRecommendation,
  getVehicleMetrics,
  toNumber
};
