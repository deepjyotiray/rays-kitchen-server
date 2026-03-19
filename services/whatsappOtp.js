const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "../config/verified-users.json");
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// In-memory OTP store: phone -> { otp, expires, attempts, name }
const otpStore = new Map();

function pruneOtpStore() {
  const now = Date.now();
  for (const [phone, entry] of otpStore) {
    if (!entry || now > entry.expires || entry.attempts >= MAX_ATTEMPTS) {
      otpStore.delete(phone);
    }
  }
}

const otpPruneTimer = setInterval(pruneOtpStore, 60 * 1000);
if (typeof otpPruneTimer.unref === "function") otpPruneTimer.unref();

function loadVerified() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveVerified(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function isVerified(phone) {
  return !!loadVerified()[phone];
}

function markVerified(phone, name) {
  const data = loadVerified();
  data[phone] = { name: name || phone, verifiedAt: new Date().toISOString() };
  saveVerified(data);
}

function getName(phone) {
  return loadVerified()[phone]?.name || phone;
}

function sendWA(target, message) {
  return new Promise((resolve, reject) => {
    execFile(
      "/opt/homebrew/bin/openclaw",
      ["message", "send", "--channel", "whatsapp", "--target", target, "--message", message],
      { timeout: 10000 },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function initiateOtp(phone) {
  const otp = generateOTP();
  otpStore.set(phone, { otp, expires: Date.now() + OTP_TTL_MS, attempts: 0 });
  await sendWA(phone, `Welcome to Ray's Home Kitchen! 🍽️\n\nYour OTP is: *${otp}*\n\nValid for 5 minutes. Reply with this OTP to verify your number.`);
}

// Returns { ok, name } or { error }
function verifyOtp(phone, text) {
  const entry = otpStore.get(phone);
  if (!entry) return { error: "no_otp" };
  if (Date.now() > entry.expires) {
    otpStore.delete(phone);
    return { error: "expired" };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(phone);
    return { error: "too_many_attempts" };
  }
  if (entry.otp !== text.trim()) {
    entry.attempts++;
    return { error: "invalid" };
  }
  otpStore.delete(phone);
  return { ok: true };
}

function hasPendingOtp(phone) {
  const entry = otpStore.get(phone);
  return entry && Date.now() <= entry.expires;
}

module.exports = { isVerified, markVerified, getName, initiateOtp, verifyOtp, hasPendingOtp, sendWA };
