const express = require('express');
const router = express.Router();

const AGENT_URL = 'http://127.0.0.1:3001/send';
const AGENT_SECRET = process.env.WHATSAPP_AGENT_SECRET || 'change-this-secret';

const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendWhatsAppOTP(mobile, otp) {
  const message = `Your Ray's Kitchen OTP is: *${otp}*\n\nValid for 5 minutes. Do not share this OTP with anyone.`;
  return fetch(AGENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-secret': AGENT_SECRET },
    body: JSON.stringify({ phone: '+91' + mobile, message })
  }).then(r => {
    if (!r.ok) throw new Error('agent returned ' + r.status);
  });
}

function normalizeMobile(raw) {
  if (!raw) return '';
  // Accept +91XXXXXXXXXX or plain 10-digit
  return String(raw).trim().replace(/^\+91/, '');
}

router.post('/send-otp', (req, res) => {
  const mobile = normalizeMobile(req.body.mobile);
  console.log('Send OTP request for:', mobile);

  if (!/^[0-9]{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'Invalid mobile number' });
  }

  const otp = generateOTP();
  const expires = Date.now() + 5 * 60 * 1000;

  console.log(`\n=== OTP for ${mobile}: ${otp} ===\n`);

  otpStore.set(mobile, { otp, expires, attempts: 0 });

  sendWhatsAppOTP(mobile, otp).catch(err => console.error('OTP send failed:', err.message));

  res.json({ success: true, message: 'OTP sent to WhatsApp' });
});

router.post('/verify-otp', (req, res) => {
  const mobile = normalizeMobile(req.body.mobile);
  const { otp } = req.body;

  if (!/^[0-9]{10}$/.test(mobile) || !/^[0-9]{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const stored = otpStore.get(mobile);
  
  if (!stored) {
    return res.status(400).json({ error: 'OTP not found or expired' });
  }

  if (Date.now() > stored.expires) {
    otpStore.delete(mobile);
    return res.status(400).json({ error: 'OTP expired' });
  }

  if (stored.attempts >= 3) {
    otpStore.delete(mobile);
    return res.status(400).json({ error: 'Too many attempts' });
  }

  if (stored.otp !== otp) {
    stored.attempts++;
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  otpStore.delete(mobile);
  req.session.mobile = '+91' + mobile;
  req.session.authenticated = true;

  res.json({ success: true, mobile: '+91' + mobile });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/session', (req, res) => {
  if (req.session.authenticated) {
    res.json({ authenticated: true, mobile: req.session.mobile });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
