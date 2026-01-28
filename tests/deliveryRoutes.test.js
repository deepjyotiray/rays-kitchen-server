const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");

const deliveryRouter = require("../routes/delivery.routes");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", deliveryRouter);
  return app;
}

test("fallbacks gracefully when coordinates are missing", async () => {
  const app = createApp();

  const res = await request(app).post("/api/delivery-charge").send({});

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, {
    distanceKm: null,
    deliveryCharge: 50,
    freeDeliveryThreshold: null,
  });
});

test("returns base pricing for nearby addresses (~0 km)", async () => {
  const app = createApp();

  const res = await request(app)
    .post("/api/delivery-charge")
    .send({ lat: 18.97624, lng: 73.023252 });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.distanceKm <= 0.05);
  assert.strictEqual(res.body.deliveryCharge, 50);
  assert.strictEqual(res.body.freeDeliveryThreshold, 1000);
});

test("returns distance-based pricing and threshold for mid-range (~11 km)", async () => {
  const app = createApp();

  const res = await request(app)
    .post("/api/delivery-charge")
    .send({ lat: 19.07624, lng: 73.023252 });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.distanceKm > 10 && res.body.distanceKm < 12.5);
  assert.strictEqual(res.body.deliveryCharge, 120);
  assert.strictEqual(res.body.freeDeliveryThreshold, 2000);
});

test("removes free delivery beyond 20 km and applies higher charges", async () => {
  const app = createApp();

  const res = await request(app)
    .post("/api/delivery-charge")
    .send({ lat: 19.22624, lng: 73.023252 });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.distanceKm > 20);
  assert.strictEqual(res.body.freeDeliveryThreshold, null);
  assert.strictEqual(res.body.deliveryCharge, 200);
});
