const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const request = require("supertest");
const crypto = require("crypto");

const originalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const originalAppSecret = process.env.WHATSAPP_APP_SECRET;

process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
process.env.WHATSAPP_APP_SECRET = "app-secret";

const whatsappRouter = require("../routes/whatsapp.routes");

function createApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use("/webhooks/whatsapp", whatsappRouter);
  return app;
}

test.after(() => {
  if (originalVerifyToken) {
    process.env.WHATSAPP_VERIFY_TOKEN = originalVerifyToken;
  } else {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  }

  if (originalAppSecret) {
    process.env.WHATSAPP_APP_SECRET = originalAppSecret;
  } else {
    delete process.env.WHATSAPP_APP_SECRET;
  }
});

test("responds with challenge when verification token matches", async () => {
  const app = createApp();

  const res = await request(app)
    .get("/webhooks/whatsapp")
    .query({
      "hub.mode": "subscribe",
      "hub.verify_token": "verify-token",
      "hub.challenge": "challenge-123",
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.text, "challenge-123");
});

test("rejects verification when token is incorrect", async () => {
  const app = createApp();

  const res = await request(app)
    .get("/webhooks/whatsapp")
    .query({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "challenge-123",
    });

  assert.strictEqual(res.status, 403);
});

test("rejects webhook POST when signature does not match", async () => {
  const app = createApp();
  const payload = { object: "whatsapp_business_account", entry: [] };
  const raw = JSON.stringify(payload);

  const res = await request(app)
    .post("/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", "sha256=bad")
    .send(raw);

  assert.strictEqual(res.status, 401);
});

test("accepts webhook POST with valid signature", async () => {
  const app = createApp();
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "test",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              messages: [
                {
                  from: "12345",
                  id: "wamid.HBgM",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "Hello" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const raw = JSON.stringify(payload);
  const signature = `sha256=${crypto
    .createHmac("sha256", "app-secret")
    .update(raw)
    .digest("hex")}`;

  const res = await request(app)
    .post("/webhooks/whatsapp")
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", signature)
    .send(raw);

  assert.strictEqual(res.status, 200);
});
