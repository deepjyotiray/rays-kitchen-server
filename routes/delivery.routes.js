const express = require("express");
const router = express.Router();
const https = require("https");

console.log("delivery.routes.js loaded");

const { getDistanceKm } = require("../services/distance.service");
const { calculateDeliveryPricing } = require("../services/deliveryPricing.service");

const REST_LAT = 18.976240;
const REST_LNG = 73.023252;
const GEOFENCE_KM = 5;

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

// Geocode an address and check if it's within GEOFENCE_KM of the restaurant
router.post("/geocode-check", (req, res) => {
  const { address } = req.body;
  if (!address || typeof address !== "string" || address.trim().length < 3) {
    return res.status(400).json({ error: "Invalid address" });
  }

  const raw = address.trim();
  // Extract PIN code if present (6-digit Indian PIN)
  const pinMatch = raw.match(/\b([1-9][0-9]{5})\b/);

  // Build queries: try full address first, then PIN-only if present
  const queries = [
    encodeURIComponent(raw + ", India"),
    ...(pinMatch ? [encodeURIComponent(pinMatch[1] + ", India")] : [])
  ];

  const options = {
    headers: { "User-Agent": "RaysHomeKitchen/1.0 (kitchen@healthymealspot.com)" }
  };

  function tryQuery(index) {
    if (index >= queries.length) {
      return res.json({ withinRange: null, distanceKm: null, reason: "address_not_found" });
    }
    const url = `https://nominatim.openstreetmap.org/search?q=${queries[index]}&format=json&limit=1`;
    https.get(url, options, (apiRes) => {
      let data = "";
      apiRes.on("data", chunk => { data += chunk; });
      apiRes.on("end", () => {
        try {
          const results = JSON.parse(data);
          if (!results.length) return tryQuery(index + 1);
          const { lat, lon } = results[0];
          const distanceKm = getDistanceKm(REST_LAT, REST_LNG, parseFloat(lat), parseFloat(lon));
          res.json({
            withinRange: distanceKm <= GEOFENCE_KM,
            distanceKm: Number(distanceKm.toFixed(2))
          });
        } catch (e) {
          res.status(500).json({ error: "Geocode parse failed" });
        }
      });
    }).on("error", () => res.status(502).json({ error: "Geocode service unavailable" }));
  }

  tryQuery(0);
});

module.exports = router;
