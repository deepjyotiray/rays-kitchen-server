const Database = require('better-sqlite3');

const DB_PATH = '/Users/deepjyotiray/Documents/FoodWebsite/ray-orders-backend/orders.db';
const SIGNUP_URL = 'https://healthymealspot.com/login';

function lookupUser(phone) {
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare("SELECT name FROM users WHERE mobile LIKE ?").get(`%${last10}`);
  } finally {
    db.close();
  }
}

function whatsappAuthGuard(phone) {
  const user = lookupUser(phone);
  if (user) return { allowed: true, name: user.name };
  return {
    allowed: false,
    reply: `Hi! To chat with us on WhatsApp, please sign up first at 👇\n${SIGNUP_URL}\n\nOnce registered, come back and say hi! 🍽️`
  };
}

module.exports = { whatsappAuthGuard };
