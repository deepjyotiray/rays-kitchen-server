/**
 * Pre-LLM message filter for Healthy Meal Spot WhatsApp bot.
 * Returns a reply string if the message can be handled without the LLM,
 * or null to fall through to the agent.
 */

const BACKEND_BASE = process.env.ORDER_BACKEND_URL || "https://admin.healthymealspot.com";

// --- Static keyword → reply map ---
const STATIC_REPLIES = [
  {
    match: /\b(hi|hello|hey|helo|hii|namaste|namaskar|good\s*(morning|afternoon|evening|night))\b/i,
    reply: `🍽️ Welcome to Healthy Meal Spot!\n\nReply with:\n• *menu* — see today's menu\n• *timings* — our hours\n• *location* — find us\n• Or just tell me what you'd like to order!`
  },
  {
    match: /\b(timing|timings|hours|open|close|when|schedule)\b/i,
    reply: `🕐 *Our Timings*\n\n🌅 Breakfast: 8:00 AM – 10:30 AM\n🍱 Lunch: 12:00 PM – 3:00 PM\n🌙 Dinner: 7:00 PM – 10:00 PM\n\nOrders close 30 mins before each slot.`
  },
  {
    match: /\b(location|address|where|directions|find you|locate)\b/i,
    reply: `📍 *Healthy Meal Spot*\n\nWe deliver to your doorstep! Share your address and we'll confirm delivery availability. 🛵`
  },
  {
    match: /\b(thank|thanks|thankyou|thank you|thx|ty)\b/i,
    reply: `❤️ Thank you! Enjoy your meal. Feel free to order again anytime!`
  },
  {
    match: /\b(bye|goodbye|ok bye|cya|see you)\b/i,
    reply: `👋 Goodbye! Come back soon. 🍽️`
  },
  {
    match: /\b(payment|pay|upi|gpay|phonepay|paytm|cash|cod)\b/i,
    reply: `💳 *Payment Options*\n\n• UPI / GPay / PhonePe / Paytm\n• Cash on Delivery\n\nPayment details will be shared when your order is confirmed. ✅`
  },
  {
    match: /\b(delivery|deliver|charge|fee|free delivery)\b/i,
    reply: `🛵 *Delivery Info*\n\nDelivery charges depend on your location. Free delivery on orders above ₹500!\n\nShare your address to get an exact estimate.`
  },
];

// --- Menu section keywords → section key in backend menu data ---
const MENU_SECTION_MAP = [
  { match: /\b(breakfast|poha|upma|idli|dosa|pav bhaji|tea|coffee)\b/i, section: 'breakfast' },
  { match: /\b(veg starter|veg snack|paneer tikka|spring roll|samosa|paneer chilli|french fries)\b/i, section: 'veg_starters' },
  { match: /\b(chicken starter|chicken tandoori|kabab|seekh|pahadi|chicken fry)\b/i, section: 'non_veg_starters' },
  { match: /\b(seafood|fish fry|pomfret|surmai|rawas|bangda|tawa fry)\b/i, section: 'SeaFood_starters' },
  { match: /\b(veg main|veg curry|paneer masala|dal|aloo|chana|mushroom|thali|veg biryani|veg pulao)\b/i, section: 'veg_main' },
  { match: /\b(chicken|mutton|egg curry|butter chicken|biryani|korma|tikka masala|keema|kofta|malai)\b/i, section: 'non_veg_main' },
  { match: /\b(rice|chapati|paratha|roti|bread|jeera rice|steamed rice)\b/i, section: 'rice&breads' },
  { match: /\b(sweet|dessert|gulab jamun|kheer|halwa|sheera|phirni|raita)\b/i, section: 'sweets' },
  { match: /\b(healthy|salad|sprouts|brown rice|subscription)\b/i, section: 'healthy' },
];

// --- Full menu trigger ---
const FULL_MENU_TRIGGER = /\b(menu|full menu|what do you have|what's available|show menu|today's menu|today menu)\b/i;

let _menuCache = null;
let _menuCacheTime = 0;
async function getMenu() {
  const now = Date.now();
  if (_menuCache && now - _menuCacheTime < 30_000) return _menuCache;
  try {
    const resp = await fetch(`${BACKEND_BASE}/menu?type=main`);
    if (!resp.ok) throw new Error("MENU_FETCH_FAILED");
    const data = await resp.json();
    _menuCache = data.menu || data || {};
  } catch {
    _menuCache = {};
  }
  _menuCacheTime = now;
  return _menuCache;
}

function formatSection(section, data) {
  const available = data.items.filter(i => i.available);
  if (!available.length) return null;
  const lines = available.map(i => `• ${i.name} — ₹${i.price}`).join('\n');
  return `*${data.title}*\n${lines}`;
}

async function handleMenuQuery(msg) {
  const menu = await getMenu();

  // Full menu request
  if (FULL_MENU_TRIGGER.test(msg)) {
    const sections = Object.values(menu)
      .map(s => formatSection(null, s))
      .filter(Boolean)
      .join('\n\n');
    return sections
      ? `🍽️ *Today's Menu*\n\n${sections}\n\nReply with item + quantity to order!`
      : null;
  }

  // Section-specific request
  for (const { match, section } of MENU_SECTION_MAP) {
    if (match.test(msg) && menu[section]) {
      const formatted = formatSection(section, menu[section]);
      if (formatted) return `${formatted}\n\nReply with item + quantity to order!`;
    }
  }

  return null;
}



// --- Main filter function ---
async function filterMessage(msg) {
  if (!msg || typeof msg !== 'string') return null;
  const text = msg.trim();

  // 1. Static keyword replies
  for (const { match, reply } of STATIC_REPLIES) {
    if (match.test(text)) return reply;
  }

  // 2. Menu queries (served from backend DB)
  const menuReply = await handleMenuQuery(text);
  if (menuReply) return menuReply;

  // 3. Fall through to LLM
  return null;
}

module.exports = { filterMessage };
