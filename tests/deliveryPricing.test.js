const test = require("node:test");
const assert = require("node:assert");

const { calculateDeliveryPricing } = require("../services/deliveryPricing.service");

test("returns fallback when distance is missing or invalid", () => {
  const result = calculateDeliveryPricing(NaN);
  assert.strictEqual(result.deliveryCharge, 50);
  assert.strictEqual(result.freeDeliveryThreshold, null);
});

test("tiers up to 5 km use ₹50 charge and ₹1000 free threshold", () => {
  [
    0,
    -3, // negative should clamp to 0
    4.9,
    5,
  ].forEach((km) => {
    const result = calculateDeliveryPricing(km);
    assert.strictEqual(result.deliveryCharge, 50);
    assert.strictEqual(result.freeDeliveryThreshold, 1000);
  });
});

test("5-10 km uses ₹80 charge and ₹1500 free threshold", () => {
  [5.1, 7, 10].forEach((km) => {
    const result = calculateDeliveryPricing(km);
    assert.strictEqual(result.deliveryCharge, 80);
    assert.strictEqual(result.freeDeliveryThreshold, 1500);
  });
});

test("10-20 km uses ₹120-₹150 charge and ₹2000 free threshold", () => {
  const midRange = calculateDeliveryPricing(12);
  assert.strictEqual(midRange.deliveryCharge, 120);
  assert.strictEqual(midRange.freeDeliveryThreshold, 2000);

  const upperRange = calculateDeliveryPricing(20);
  assert.strictEqual(upperRange.deliveryCharge, 150);
  assert.strictEqual(upperRange.freeDeliveryThreshold, 2000);
});

test("beyond 20 km removes free delivery and escalates charges up to ₹500", () => {
  const ranges = [
    { km: 25, charge: 200 },
    { km: 35, charge: 300 },
    { km: 45, charge: 400 },
    { km: 60, charge: 500 },
  ];

  ranges.forEach(({ km, charge }) => {
    const result = calculateDeliveryPricing(km);
    assert.strictEqual(result.deliveryCharge, charge);
    assert.strictEqual(result.freeDeliveryThreshold, null);
  });
});
