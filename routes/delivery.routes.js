const express = require("express");
const router = express.Router();

console.log("delivery.routes.js loaded");

const { getDistanceKm } = require("../services/distance.service");
const { calculateDeliveryPricing } = require("../services/deliveryPricing.service");

const REST_LAT = 18.976240;
const REST_LNG = 73.023252;

router.post("/delivery-charge", (req, res) => {
  const { lat, lng } = req.body;

  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    const { deliveryCharge, freeDeliveryThreshold } =
      calculateDeliveryPricing();

    return res.json({
      distanceKm: null,
      deliveryCharge,
      freeDeliveryThreshold,
    });
  }

  // Validate coordinate ranges
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  const distanceKm = getDistanceKm(REST_LAT, REST_LNG, latNum, lngNum);
  const { deliveryCharge, freeDeliveryThreshold } =
    calculateDeliveryPricing(distanceKm);

  res.json({
    distanceKm: Number(distanceKm.toFixed(2)),
    deliveryCharge,
    freeDeliveryThreshold,
  });
});

module.exports = router;
