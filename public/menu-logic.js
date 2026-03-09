/**
 * Pure logic extracted from menu.js for unit testing.
 * No DOM / window dependencies.
 */

/* ── Date helpers ── */
function getStartOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseISODate(val) {
  if (!val) return null;
  const d = new Date(val + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ── isDateClosed ── */
function isDateClosed(date, { kitchenClosedToday = false, kitchenClosures = [], today = new Date() } = {}) {
  const day = getStartOfDay(date);
  const todayStart = getStartOfDay(today);
  if (kitchenClosedToday && day.getTime() === todayStart.getTime()) return true;
  return kitchenClosures.some((c) => {
    const start = parseISODate(c.start_date);
    const end = parseISODate(c.end_date || c.start_date);
    if (!start || !end) return false;
    return day >= start && day <= end;
  });
}

/* ── matchesFilters ── */
function matchesFilters(item, { vegOnly = false, searchQuery = "" } = {}) {
  if (vegOnly && !item.veg) return false;
  const name = (item.name || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const q = searchQuery.toLowerCase();
  if (q && !name.includes(q) && !desc.includes(q)) return false;
  return true;
}

/* ── Cart subtotals ── */
function getCartSubtotal(selectedItems) {
  let total = 0;
  Object.values(selectedItems).forEach((i) => { total += i.qty * i.price; });
  return total;
}

function isSeafoodItem(itemId = "") {
  return itemId.toLowerCase().startsWith("seafood_starters__");
}

function getFreeEligibleSubtotal(selectedItems) {
  let total = 0;
  Object.entries(selectedItems).forEach(([id, item]) => {
    if (isSeafoodItem(id)) return;
    let lineTotal = item.qty * item.price;
    if (item.extras) Object.values(item.extras).forEach((p) => { lineTotal += p * item.qty; });
    total += lineTotal;
  });
  return total;
}

/* ── validateCoupon ── */
function validateCoupon(enteredCoupon, subtotal, coupons, baseFreeDeliveryTarget = 1500) {
  let discountAmount = 0;
  let appliedCoupon = null;
  let freeDeliveryTarget = baseFreeDeliveryTarget;

  if (!enteredCoupon || !coupons[enteredCoupon]) return { discountAmount, appliedCoupon, freeDeliveryTarget };

  const rule = coupons[enteredCoupon];
  if (rule.active === false) return { discountAmount, appliedCoupon, freeDeliveryTarget };

  const minOrder = Number(rule.minOrder) || 0;
  if (subtotal < minOrder) return { discountAmount, appliedCoupon, freeDeliveryTarget };

  let computedDiscount = 0;
  if (!rule.freeDeliveryOnly) {
    if (rule.isPercent) {
      computedDiscount = Math.floor((subtotal * (Number(rule.discount) || 0)) / 100);
      const maxCap = Number(rule.maxDiscount) || 0;
      if (maxCap > 0) computedDiscount = Math.min(computedDiscount, maxCap);
    } else {
      computedDiscount = Number(rule.discount) || 0;
    }
  }

  discountAmount = computedDiscount;
  appliedCoupon = enteredCoupon;
  if (rule.freeDelivery || rule.freeDeliveryOnly) freeDeliveryTarget = 0;

  return { discountAmount, appliedCoupon, freeDeliveryTarget };
}

/* ── updateQty (pure state, no DOM) ── */
function updateQty(selectedItems, id, name, price, delta) {
  const items = { ...selectedItems };
  if (!items[id]) items[id] = { name, price, qty: 0, extras: {} };
  items[id] = { ...items[id], qty: items[id].qty + delta };
  if (items[id].qty <= 0) delete items[id];
  return items;
}

/* ── toggleExtra (pure state, no DOM) ── */
function toggleExtra(selectedItems, itemId, extraName, extraPrice, checked) {
  if (!selectedItems[itemId]) return selectedItems;
  const item = { ...selectedItems[itemId], extras: { ...selectedItems[itemId].extras } };
  if (checked) item.extras[extraName] = extraPrice;
  else delete item.extras[extraName];
  return { ...selectedItems, [itemId]: item };
}

module.exports = {
  isDateClosed, matchesFilters,
  getCartSubtotal, getFreeEligibleSubtotal,
  validateCoupon, updateQty, toggleExtra,
};
