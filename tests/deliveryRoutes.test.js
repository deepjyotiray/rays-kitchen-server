const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const https = require("https");
const { EventEmitter } = require("events");

const deliveryRouter = require("../routes/delivery.routes");

function mockNominatim(responseBody) {
  const original = https.get;
  https.get = (_url, _opts, cb) => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const req = new EventEmitter();
    setImmediate(() => {
      cb(res);
      res.emit("data", JSON.stringify(responseBody));
      res.emit("end");
    });
    return req;
  };
  return () => { https.get = original; };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", deliveryRouter);
  return app;
}

// ── geocode-check tests ──────────────────────────────────────────────────────

test("geocode-check: blocks address outside 5km (Kolkata scenario)", async () => {
  // First query (full address) returns empty, second (PIN 743141) returns Kolkata coords
  let call = 0;
  const original = https.get;
  https.get = (_url, _opts, cb) => {
    const body = call++ === 0 ? [] : [{ lat: "22.5726", lon: "88.3639" }];
    const apiRes = Object.assign(new EventEmitter(), { statusCode: 200 });
    const req = new EventEmitter();
    setImmediate(() => { cb(apiRes); apiRes.emit("data", JSON.stringify(body)); apiRes.emit("end"); });
    return req;
  };
  const app = createApp();
  const res = await request(app)
    .post("/api/geocode-check")
    .send({ address: "Kolkata 743141" });
  https.get = original;

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.withinRange, false);
  assert.ok(res.body.distanceKm > 5);
});

test("geocode-check: allows address within 5km", async () => {
  // ~0.5km from restaurant
  const restore = mockNominatim([{ lat: "18.980", lon: "73.025" }]);
  const app = createApp();
  const res = await request(app)
    .post("/api/geocode-check")
    .send({ address: "Sector 7, Kharghar, Navi Mumbai" });
  restore();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.withinRange, true);
  assert.ok(res.body.distanceKm <= 5);
});

test("geocode-check: returns withinRange null when address not found", async () => {
  const restore = mockNominatim([]);
  const app = createApp();
  const res = await request(app)
    .post("/api/geocode-check")
    .send({ address: "xyzzy nonexistent place 99999" });
  restore();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.withinRange, null);
  assert.strictEqual(res.body.distanceKm, null);
});

test("geocode-check: rejects missing or too-short address", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/api/geocode-check")
    .send({ address: "ab" }); // 2 chars, below minimum of 3

  assert.strictEqual(res.status, 400);
});

test("geocode-check: blocks short city name outside 5km (Pune)", async () => {
  const restore = mockNominatim([{ lat: "18.5204", lon: "73.8567" }]); // Pune coords ~150km away
  const app = createApp();
  const res = await request(app)
    .post("/api/geocode-check")
    .send({ address: "Pune" });
  restore();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.withinRange, false);
  assert.ok(res.body.distanceKm > 5);
});

// ── existing delivery-charge tests ──────────────────────────────────────────

test("delivery-charge: returns distanceKm > 5 for Kolkata coords (GPS geofence)", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/api/delivery-charge")
    .send({ lat: 22.5726, lng: 88.3639 }); // Kolkata

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.distanceKm > 5, `Expected >5km, got ${res.body.distanceKm}`);
});
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
