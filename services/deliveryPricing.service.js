const FALLBACK_DELIVERY_CHARGE = 50;

function calculateDeliveryPricing(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return {
      deliveryCharge: FALLBACK_DELIVERY_CHARGE,
      freeDeliveryThreshold: null,
    };
  }

  const km = Math.max(0, distanceKm);

  return {
    deliveryCharge: getChargeForDistance(km),
    freeDeliveryThreshold: getFreeDeliveryThreshold(km),
  };
}

function getChargeForDistance(km) {
  if (km <= 5) return 50;
  if (km <= 10) return 80;
  if (km <= 15) return 120;
  if (km <= 20) return 150;
  if (km <= 30) return 200;
  if (km <= 40) return 300;
  if (km <= 50) return 400;
  return 500;
}

function getFreeDeliveryThreshold(km) {
  if (km <= 5) return 1000;
  if (km <= 10) return 1500;
  if (km <= 20) return 2000;
  return null; // No free delivery beyond 20 km
}

module.exports = { calculateDeliveryPricing };
