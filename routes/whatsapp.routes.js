const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const CONFIG_PATH = path.join(__dirname, "..", "config", "whatsapp-webhook.json");

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const cfg = readConfig();

const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || cfg.verifyToken || "set-verify-token";
const APP_SECRET =
  process.env.WHATSAPP_APP_SECRET || cfg.appSecret || "";

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "whatsapp-webhook.log");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logEvent(event) {
  try {
    ensureLogDir();
    const line = `${new Date().toISOString()} ${event}\n`;
    fs.appendFile(LOG_FILE, line, () => {});
  } catch (err) {
    console.error("Failed to log webhook event:", err.message);
  }
}

function verifySignature(req, rawBody) {
  if (!APP_SECRET) return true; // signature verification disabled
  const provided = req.get("X-Hub-Signature-256") || "";
  if (!provided) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", APP_SECRET)
    .update(rawBody)
    .digest("hex")}`;

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (providedBuf.length !== expectedBuf.length) return false;

  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && challenge) {
    if (token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Verification token mismatch");
  }

  res.status(400).send("Invalid verification request");
});

router.post("/", (req, res) => {
  const rawBody =
    req.rawBody ||
    Buffer.from(JSON.stringify(req.body || {}, null, 0), "utf8");

  if (!verifySignature(req, rawBody)) {
    logEvent("signature_mismatch");
    return res.status(401).send("Invalid signature");
  }

  const payload = req.body || {};

  if (payload.object !== "whatsapp_business_account") {
    logEvent(`ignored_payload object=${payload.object || "unknown"}`);
    return res.status(200).send("ignored");
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  entries.forEach(entry => {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    changes.forEach(change => {
      const value = change.value || {};
      const messages = Array.isArray(value.messages) ? value.messages : [];

      if (!messages.length) {
        logEvent(
          `change field=${change.field || "unknown"} product=${value.messaging_product || "unknown"}`
        );
        return;
      }

      messages.forEach(msg => {
        const from = msg.from || "unknown";
        const type = msg.type || "unknown";
        const text =
          msg.text && typeof msg.text.body === "string"
            ? msg.text.body.replace(/\s+/g, " ").trim().slice(0, 160)
            : "";
        const textSummary = text ? ` text="${text}"` : "";
        logEvent(`message from=${from} type=${type}${textSummary}`);
      });
    });
  });

  res.sendStatus(200);
});

module.exports = router;
