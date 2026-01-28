/* ================= GLOBALS ================= */
window.ORDER_FOR_DATE = window.ORDER_FOR_DATE || new Date();

const API_URL = "https://api.healthymealspot.com/orders";
let freeDeliveryTarget = Number(window.FREE_DELIVERY_TARGET) || 1500;
let baseFreeDeliveryTarget = freeDeliveryTarget;

let menuData = {};
let vegOnly = false;
let selectedItems = {};
let orderDay = "today";
let orderType = new Date().getHours() < 16 ? "Lunch" : "Dinner";
const kitchenClosedToday = () => window.KITCHEN_CLOSED_TODAY === true;
let kitchenClosures = [];

let customerName = "",
  customerPhone = "",
  customerAddress = "",
  customerNotes = "";

let locationAllowed = true,
  capturedLocation = null,
  deliveryCharge = Number(window.DEFAULT_DELIVERY_CHARGE) || 0,
  deliveryDistanceKm = 0;

let enteredCoupon = null,
  appliedCoupon = null,
  discountAmount = 0;

let cartHasItems = false,
  cartMinimized = false,
  lastScrollY = window.scrollY,
  lastCartCount = 0;
let lastAddedItemId = null,
  cartHighlightTimer = null;
let cartTouchStartY = null,
  cartTouchActive = false;
let cartInteractionLocked = false,
  cartFocusResetTimer = null;

let coupons = {};
let searchQuery = "";
let priceFilter = "all";

function getStartOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getTodayStart() {
  return getStartOfDay(new Date());
}

function getTomorrowStart() {
  const d = getTodayStart();
  d.setDate(d.getDate() + 1);
  return d;
}

function parseISODate(val) {
  if (!val) return null;
  const d = new Date(val + "T00:00:00");
  if (Number.isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function isDateClosed(date) {
  const day = getStartOfDay(date);
  if (kitchenClosedToday() && day.getTime() === getTodayStart().getTime()) {
    return true;
  }
  return kitchenClosures.some((c) => {
    const start = parseISODate(c.start_date);
    const end = parseISODate(c.end_date || c.start_date);
    if (!start || !end) return false;
    return day >= start && day <= end;
  });
}

function findNextOpenDate(fromDate = new Date()) {
  const start = getStartOfDay(fromDate);
  for (let i = 0; i < 90; i++) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + i);
    if (!isDateClosed(candidate)) return candidate;
  }
  return start;
}

function syncOrderDayFromDate() {
  const selected = getStartOfDay(window.ORDER_FOR_DATE || new Date());
  const today = getStartOfDay(new Date());
  orderDay = selected > today ? "tomorrow" : "today";
  if (kitchenClosedToday() && orderDay === "today") {
    orderDay = "tomorrow";
    window.ORDER_FOR_DATE = getTomorrowStart();
  }
}

syncOrderDayFromDate();

/* ================= DELIVERY (AUTO ON LOAD) ================= */
async function initDeliveryCharge() {
  locationAllowed = true;

  if (!navigator.geolocation) {
    locationAllowed = false;
    capturedLocation = null;
    deliveryCharge = Number(window.DEFAULT_DELIVERY_CHARGE) || 50;
    freeDeliveryTarget = null;
    baseFreeDeliveryTarget = freeDeliveryTarget;
    updateCart();
    showLocationBlockedBanner();
    return;
  }

  let pos;

  try {
    pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });
    });
  } catch (e) {
    locationAllowed = false;
    capturedLocation = null;
    deliveryCharge = Number(window.DEFAULT_DELIVERY_CHARGE) || 50;
    freeDeliveryTarget = null;
    showLocationBlockedBanner();
    updateCart();
    return;
  }

  capturedLocation = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy || null,
    capturedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch("/api/delivery-charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: capturedLocation.lat,
        lng: capturedLocation.lng,
      }),
    });

    if (!res.ok) throw new Error("DELIVERY_API_FAILED");

    const data = await res.json();
    deliveryCharge = Number(data.deliveryCharge) || 0;
    deliveryDistanceKm = Number(data.distanceKm) || 0;
    if ("freeDeliveryThreshold" in data) {
      freeDeliveryTarget =
        data.freeDeliveryThreshold === null
          ? null
          : Number(data.freeDeliveryThreshold) || freeDeliveryTarget;
      baseFreeDeliveryTarget = freeDeliveryTarget;
    }
  } catch (e) {
    deliveryCharge = Number(window.DEFAULT_DELIVERY_CHARGE) || 50;
    deliveryDistanceKm = 0;
    freeDeliveryTarget = null;
    baseFreeDeliveryTarget = freeDeliveryTarget;
  }

  updateCart();
}

function showLocationBlockedBanner() {
  let banner = document.getElementById("location-blocked-banner");

  if (!banner) {
    banner = document.createElement("div");
    banner.id = "location-blocked-banner";
    banner.style.cssText = `
    background: #fff6f6;
    color: #8a2d2d;
    padding: 8px 12px;
    margin: 10px 12px;
    border-radius: 6px;
    text-align: center;
    font-weight: 500;
    font-size: 13px;
    border: 1px solid #f2caca;
    `;

    banner.innerHTML = `
      📍 Location access not provided.<br>
      Delivery charges will be added as per actuals.
    `;

    const header = document.querySelector(".header");
    if (header) {
      header.insertAdjacentElement("afterend", banner);
    } else {
      document.body.prepend(banner);
    }
  }
}

/* ================= HELPERS & MENU LOAD ================= */
fetch("/coupons.json?v=" + Date.now())
  .then((r) => r.json())
  .then((d) => (coupons = d || {}));

function safeItemKey(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function matchesFilters(item) {
  if (vegOnly && !item.veg) return false;

  const name = (item.name || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const hasText =
    !searchQuery ||
    name.includes(searchQuery) ||
    desc.includes(searchQuery);

  if (!hasText) return false;

  if (!item.price || priceFilter === "all") return true;

  const p = Number(item.price);
  if (Number.isNaN(p)) return true;

  // price filtering disabled (all)

  return true;
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getAvailabilityLabel(key, available) {
  const selected = getStartOfDay(window.ORDER_FOR_DATE || new Date());
  const today = getTodayStart();
  const isTodaySelected = selected.getTime() === today.getTime();
  const now = nowMinutes();
  const opening = 7 * 60;

  if (available) return "";

  if (isDateClosed(selected)) {
    return isTodaySelected
      ? "Ordering for today is closed"
      : "Kitchen is closed for selected date";
  }

  if (isTodaySelected && now < opening) return "Opens at 7:00 AM";

  if (key === "breakfast" && isTodaySelected && now >= 9 * 60)
    return "Breakfast ended for today";

  return "Available on the next open day";
}

function isSectionAvailable(key) {
  const selected = getStartOfDay(window.ORDER_FOR_DATE || new Date());

  if (isDateClosed(selected)) return false;

  if (orderDay === "tomorrow") return true;

  const t = nowMinutes();
  if (t < 7 * 60) return false;
  if (key === "breakfast") return t < 9 * 60;

  return t < 24 * 60;
}

const isCorporatePage = window.location.pathname
  .toLowerCase()
  .includes("corporate");

const MENU_FILE = isCorporatePage ? "corporate_menu.json" : "menu.json";

async function refreshKitchenState() {
  const wasClosed = kitchenClosedToday();
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("STATE_LOAD_FAILED");
    const data = await res.json();
    window.KITCHEN_CLOSED_TODAY = !!data.kitchenClosedToday;
    kitchenClosures = Array.isArray(data.closures) ? data.closures : [];
    window.KITCHEN_CLOSURES = kitchenClosures;

    if (kitchenClosedToday() && typeof window.ORDER_FOR_DATE !== "undefined") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      window.ORDER_FOR_DATE = tomorrow;

      if (typeof selectedDate !== "undefined") {
        selectedDate = new Date(tomorrow);
        if (typeof updateSelectedLabel === "function") updateSelectedLabel();
        if (typeof renderCalendar === "function") renderCalendar();
      }
    }
    syncOrderDayFromDate();
    showKitchenClosedBanner();
    updateEtaLabel();
    syncCartVisibility();
    if (typeof renderCalendar === "function") renderCalendar();
    if (typeof updateSelectedLabel === "function") updateSelectedLabel();

    // If we just reopened and date was auto-pushed to tomorrow, pull back to today by default
    if (!kitchenClosedToday() && wasClosed) {
      const current = getStartOfDay(window.ORDER_FOR_DATE || new Date());
      if (current.getTime() === getTomorrowStart().getTime()) {
        window.ORDER_FOR_DATE = getTodayStart();
        syncOrderDayFromDate();
        if (typeof selectedDate !== "undefined") {
          selectedDate = new Date(window.ORDER_FOR_DATE);
        }
        if (typeof renderCalendar === "function") renderCalendar();
        if (typeof updateSelectedLabel === "function") updateSelectedLabel();
      }
    }

    // If selected date falls into a closure, move to the next open day
    const maybeClosed = getStartOfDay(window.ORDER_FOR_DATE || new Date());
    if (isDateClosed(maybeClosed)) {
      const next = findNextOpenDate(new Date(maybeClosed.getTime() + 86400000));
      window.ORDER_FOR_DATE = next;
      syncOrderDayFromDate();
      if (typeof selectedDate !== "undefined") {
        selectedDate = new Date(window.ORDER_FOR_DATE);
      }
      if (typeof renderCalendar === "function") renderCalendar();
      if (typeof updateSelectedLabel === "function") updateSelectedLabel();
    }
  } catch (e) {
    syncOrderDayFromDate();
  }
}

async function fetchMenuData() {
  try {
    const res = await fetch(MENU_FILE);
    if (!res.ok) throw new Error("MENU_LOAD_FAILED");
    const data = await res.json();
    menuData = data.menu || data;
    renderMenu();
  } catch (err) {
    console.error("Failed to load menu:", err);
    menuData = {};
    renderMenu();
  }
}

(async function initApp() {
  // Default to today before remote state arrives
  window.ORDER_FOR_DATE = getTodayStart();
  syncOrderDayFromDate();
  try {
    await refreshKitchenState();
  } catch (e) {
    console.warn("Kitchen state load failed", e);
  }
  await fetchMenuData();
})();

/* ---------- RENDER MENU ---------- */
function renderMenu() {
  cleanupUnavailableSelections();
  showKitchenClosedBanner();

  const c = document.getElementById("menu-container");
  c.innerHTML = "";

  let renderedAny = false;
  let renderIndex = 0;

  Object.entries(menuData).forEach(([k, s], idx) => {
    const available = isSectionAvailable(k);
    const collapsed = false;

    const filteredItems = (s.items || []).filter(
      (itm) => (itm.available !== false) && matchesFilters(itm)
    );

    // During search, hide sections with zero matches
    if (searchQuery && filteredItems.length === 0) {
      return;
    }

    const sec = document.createElement("section");
    sec.className = "section card-appear";
    sec.id = `section-${safeItemKey(k)}`;
    sec.style.animationDelay = `${renderIndex * 60}ms`;

    const availabilityLabel = getAvailabilityLabel(k, available);
    sec.title = availabilityLabel;

    sec.innerHTML = `
      <div class="section-header ${
        !available ? "disabled-section" : ""
      }" onclick="toggleSection('${k}')">

        <h2>${s.title}</h2>

        <span class="chevron" id="chev-${k}">
          ${collapsed ? "▸" : "▾"}
        </span>
      </div>

      ${s.subheading ? `<div class="menu-subheading">${s.subheading}</div>` : ""}
      ${
        availabilityLabel
          ? `<div class="section-availability ${available ? "open" : "closed"}">
        ${availabilityLabel}
      </div>`
          : ""
      }

      <div class="menu-grid ${
        collapsed ? "collapsed" : ""
      }" id="grid-${k}">
        ${filteredItems.length
          ? filteredItems
          .map((i) => {
            const itemId = `${k}__${i.name}`;
            const itemDomKey = safeItemKey(itemId);
            const extrasId = `extras-${itemDomKey}`;
            const hasExtras = s.note && s.note["Extras available"];
            const inCart = selectedItems[itemId]?.qty > 0;
            const qty = selectedItems[itemId]?.qty || 0;
            const minusDisabledAttr =
              !available || qty <= 0 ? "disabled" : "";
            const plusDisabledAttr = !available ? "disabled" : "";
            const plusActiveClass =
              qty > 0 && available ? " qty-plus-active" : "";

            return `
              <div class="menu-item ${!available ? "disabled" : ""} ${
              inCart ? "menu-item-in-cart" : ""
            }" data-item-key="${itemDomKey}">
              <div>
                  <div class="item-name">
                    <span class="food-indicator ${
                      i.veg ? "veg" : "non-veg"
                    }"></span>
                    ${i.name}
                  </div>

                  ${
                    i.description
                      ? `<div class="item-desc">${i.description}</div>`
                      : ""
                  }

                  <div class="item-price">
                    ${
                      k === "SeaFood_starters"
                        ? "Market Price"
                        : `Rs. ${i.price}`
                    }
                  </div>

                  ${
                    hasExtras
                      ? `
                        <div class="extras" id="${extrasId}" style="display:none">
                          ${hasExtras
                            .map(
                              (ex) => `
                                <label class="extra-option">
                                  <input type="checkbox"
                                    onchange="toggleExtra('${itemId}','${ex.item}',${ex.price},this.checked)">
                                  ${ex.item} (+₹${ex.price})
                                </label>
                              `
                            )
                            .join("")}
                        </div>
                      `
                      : ""
                  }
                </div>

                <div class="qty-box">
                  <button class="qty-btn qty-minus" data-item-key="${itemDomKey}" data-action="minus" data-available="${available}" ${minusDisabledAttr} onclick="updateQty('${itemId}','${i.name}',${i.price},-1)" aria-label="Remove ${i.name}">−</button>

                  <span class="menu-qty" data-id="${itemId}">
                    ${selectedItems[itemId]?.qty || 0}
                  </span>

                  <button class="qty-btn qty-plus${plusActiveClass}" data-item-key="${itemDomKey}" data-action="plus" data-available="${available}" ${plusDisabledAttr} onclick="updateQty('${itemId}','${i.name}',${i.price},1)" aria-label="Add ${i.name}">+</button>
                </div>
              </div>
            `;
          })
          .join("")
          : `<div class="empty-state" style="grid-column: 1 / -1;">No items in this section right now.</div>`}
      </div>
    `;

    c.appendChild(sec);
    renderedAny = true;
    renderIndex += 1;
  });

  if (!renderedAny) {
    c.innerHTML = `<div class="empty-state">No dishes match your filters right now.</div>`;
  }
  updateCart();
}

window.toggleSection = function (key) {
  const grid = document.getElementById("grid-" + key);
  const chev = document.getElementById("chev-" + key);

  if (!grid || !chev) return;

  const isCollapsed = grid.classList.contains("collapsed");

  grid.classList.toggle("collapsed");
  chev.textContent = isCollapsed ? "▾" : "▸";
};

/* ---------- UPDATE QTY ---------- */
function updateQty(id, name, price, delta) {
  if (!selectedItems[id])
    selectedItems[id] = { name, price, qty: 0, extras: {} };

  selectedItems[id].qty += delta;

  if (delta > 0) {
    lastAddedItemId = id;
    if (cartHighlightTimer) clearTimeout(cartHighlightTimer);
    cartHighlightTimer = setTimeout(() => {
      if (lastAddedItemId === id) {
        lastAddedItemId = null;
        updateCart();
      }
    }, 900);

    flashMenuItem(id);

    if (typeof showToast === "function") {
      showToast(`${name} added to plate`);
    }

    if (navigator?.vibrate) {
      navigator.vibrate(12);
    }
  }

  const extrasBox = document.getElementById(
    "extras-" + safeItemKey(id)
  );

  if (extrasBox)
    extrasBox.style.display = selectedItems[id].qty > 0 ? "block" : "none";

  if (selectedItems[id].qty <= 0) delete selectedItems[id];

  updateCart();
  updateMenuQtyUI(id);
}

function updateMenuQtyUI(itemId) {
  const span = document.querySelector(`.menu-qty[data-id="${itemId}"]`);
  const qty = selectedItems[itemId]?.qty || 0;
  if (span) span.textContent = qty;

  const domKey = safeItemKey(itemId);
  const itemEl = document.querySelector(
    `.menu-item[data-item-key="${domKey}"]`
  );
  if (itemEl) itemEl.classList.toggle("menu-item-in-cart", qty > 0);

  const decBtn = document.querySelector(
    `.qty-btn[data-item-key="${domKey}"][data-action="minus"]`
  );
  const incBtn = document.querySelector(
    `.qty-btn[data-item-key="${domKey}"][data-action="plus"]`
  );

  if (decBtn) {
    const available = decBtn.dataset.available !== "false";
    decBtn.disabled = !available || qty <= 0;
  }

  if (incBtn) {
    const available = incBtn.dataset.available !== "false";
    incBtn.classList.toggle("qty-plus-active", available && qty > 0);
    if (available) incBtn.disabled = false;
  }
}

function toggleExtra(itemId, extraName, extraPrice, checked) {
  if (!selectedItems[itemId]) return;

  if (checked) selectedItems[itemId].extras[extraName] = extraPrice;
  else delete selectedItems[itemId].extras[extraName];

  updateCart();
}

function cleanupUnavailableSelections() {
  Object.keys(selectedItems).forEach((id) => {
    const sectionKey = id.split("__")[0];
    const section = menuData[sectionKey];
    const item = (section?.items || []).find((i) => `${sectionKey}__${i.name}` === id);

    const itemUnavailable = item && item.available === false;

    if (
      !id.startsWith("motd__") &&
      (!isSectionAvailable(sectionKey) || itemUnavailable)
    ) {
      delete selectedItems[id];
    }
  });
}

/* ---------- CART ---------- */
function updateCart() {
  const c = document.getElementById("cart-items");
  const t = document.getElementById("cart-total");
  const b = document.getElementById("cart-order-btn");
  const itemCount = Object.values(selectedItems).reduce((s, i) => s + i.qty, 0);

  if (kitchenClosedToday() && orderDay === "today") {
    b.disabled = true;
  }

  c.innerHTML = `<div class="cart-header-row"><span>Item</span><span>Rate</span><span>Qty</span></div>`;

  let total = 0;
  let freeEligibleSubtotal = 0;

  Object.entries(selectedItems).forEach(([itemId, i]) => {
    let extrasCost = 0;
    const highlightClass =
      lastAddedItemId && lastAddedItemId === itemId ? " cart-row-highlight" : "";

    if (i.extras)
      Object.values(i.extras).forEach((p) => (extrasCost += p * i.qty));

    total += i.qty * i.price + extrasCost;
    if (!isSeafoodItem(itemId)) {
      freeEligibleSubtotal += i.qty * i.price + extrasCost;
    }

    c.innerHTML += `
      <div class="cart-row${highlightClass}">
        <div class="cart-item">
          <div class="cart-item-title">${i.name}</div>
          ${
            i.extras && Object.keys(i.extras).length
              ? `<div class="cart-item-extras">${Object.keys(i.extras)
                  .map((n) => `+ ${n}`)
                  .join(", ")}</div>`
              : ""
          }
        </div>
        <div class="cart-rate">₹${i.price}</div>
        <div class="cart-qty">
          <button onclick="updateQty('${itemId}','${i.name}',${i.price},-1)">−</button>
          <span>${i.qty}</span>
          <button onclick="updateQty('${itemId}','${i.name}',${i.price},1)">+</button>
        </div>
      </div>`;
  });

  validateCoupon(total);

  const subtotalBeforeDelivery = Math.max(total - discountAmount, 0);
  const eligibleSubtotalBeforeDelivery = Math.max(
    freeEligibleSubtotal - discountAmount,
    0
  );

  if (deliveryCharge > 0 || !locationAllowed) {
    const deliveryWaived =
      locationAllowed &&
      freeDeliveryTarget !== null &&
      eligibleSubtotalBeforeDelivery >= freeDeliveryTarget;
    const appliedDeliveryCharge = locationAllowed
      ? deliveryWaived
        ? 0
        : deliveryCharge
      : deliveryCharge || Number(window.DEFAULT_DELIVERY_CHARGE) || 50;

    const deliveryLabel = locationAllowed
      ? `₹${appliedDeliveryCharge}`
      : `Est. ₹${appliedDeliveryCharge} (final fee later)`;

    c.innerHTML += `
      <div class="cart-row">
        <span class="delivery-label">🚚 Delivery:</span>
        <span class="cart-rate">${deliveryLabel}</span>
      </div>`;
  }

  const deliveryWaived =
    locationAllowed &&
    freeDeliveryTarget !== null &&
    eligibleSubtotalBeforeDelivery >= freeDeliveryTarget;
  const appliedDeliveryCharge = locationAllowed
    ? deliveryWaived
      ? 0
      : deliveryCharge
    : deliveryCharge;
  updateCartProgress(eligibleSubtotalBeforeDelivery, deliveryWaived);

  const finalTotal = Math.max(subtotalBeforeDelivery + appliedDeliveryCharge, 0);
  t.textContent = `₹${finalTotal}`;

  b.disabled = finalTotal === 0;
  updateCartSummary(finalTotal, itemCount);
  updateEtaLabel();
  syncCartVisibility();
}

/* ---------- COUPONS ---------- */
window.applyCoupon = function () {
  const code = document
    .getElementById("coupon-input")
    .value.trim()
    .toUpperCase();

  enteredCoupon = code;
  updateCart();

  if (typeof showToast === "function") {
    if (appliedCoupon) {
      showToast(`Coupon ${appliedCoupon} applied`);
    } else if (enteredCoupon) {
      showToast("Coupon added. Reach minimum order to apply.");
    }
  }
};

function validateCoupon(subtotal) {
  discountAmount = 0;
  appliedCoupon = null;
  freeDeliveryTarget = baseFreeDeliveryTarget;

  if (!enteredCoupon || !coupons[enteredCoupon]) return;

  const rule = coupons[enteredCoupon];
  if (rule.active === false) return;

  const minOrder = Number(rule.minOrder) || 0;
  if (subtotal < minOrder) return;

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

  if (rule.freeDelivery || rule.freeDeliveryOnly) {
    freeDeliveryTarget = 0;
  }
}

function getCartSubtotal() {
  let total = 0;

  Object.values(selectedItems).forEach((i) => {
    total += i.qty * i.price;
  });

  return total;
}

function isSeafoodItem(itemId = "") {
  return itemId.toLowerCase().startsWith("seafood_starters__");
}

function getFreeEligibleSubtotal() {
  let total = 0;

  Object.entries(selectedItems).forEach(([id, item]) => {
    if (isSeafoodItem(id)) return;

    let lineTotal = item.qty * item.price;
    if (item.extras) {
      Object.values(item.extras).forEach((p) => {
        lineTotal += p * item.qty;
      });
    }

    total += lineTotal;
  });

  return total;
}

/* ---------- ORDERING ---------- */
window.orderOnWhatsApp = function () {
  if (!Object.keys(selectedItems).length) return;
  if (kitchenClosedToday() && orderDay === "today") {
    showToast("Ordering for today is closed. Please switch to tomorrow.");
    return;
  }
  document.getElementById("customer-modal").classList.add("show");
};

window.closeCustomerModal = () =>
  document.getElementById("customer-modal").classList.remove("show");

window.confirmOrder = function () {
  customerName = document.getElementById("cust-name").value.trim();
  customerPhone = document.getElementById("cust-phone").value.trim();
  customerAddress = document.getElementById("cust-address").value.trim();
  customerNotes = document.getElementById("cust-notes").value.trim();

  if (!customerName || !customerAddress) {
    alert("Please enter Name and Address");
    return;
  }

  if (kitchenClosedToday() && orderDay === "today") {
    showToast("Ordering for today is closed. Please pick tomorrow.");
    return;
  }

  closeCustomerModal();

  const waWindow = window.open("", "_blank");
  setTimeout(() => placeFinalOrder(waWindow), 50);
};

async function placeFinalOrder(waWindow) {
  let subtotal = 0;
  let itemsText = "";
  const eligibleSubtotal = Math.max(getFreeEligibleSubtotal() - discountAmount, 0);
  const deliveryWaived =
    locationAllowed &&
    freeDeliveryTarget !== null &&
    eligibleSubtotal >= freeDeliveryTarget;
  const appliedDeliveryCharge = locationAllowed
    ? deliveryWaived
      ? 0
      : deliveryCharge
    : deliveryCharge;

  /* ✅ Build Items (Menu extras stay ONLY here) */
  Object.entries(selectedItems).forEach(([id, item]) => {
    let extrasText = "";

    if (item.extras && Object.keys(item.extras).length) {
      extrasText = Object.keys(item.extras)
        .map((n) => `+ ${n}`)
        .join(", ");
    }

    let lineTotal = item.price * item.qty;

    if (item.extras) {
      Object.values(item.extras).forEach((p) => {
        lineTotal += p * item.qty;
      });
    }

    subtotal += lineTotal;

    itemsText += `• ${item.name} x ${item.qty}${
      extrasText ? ` (${extrasText})` : ""
    } = ₹${lineTotal}\n`;
  });

  /* ✅ Extras Field ONLY Delivery + Coupon */
  let extrasField = "";

  if (locationAllowed) {
    extrasField += `Delivery Charge: ₹${appliedDeliveryCharge}\n`;
  } else if (deliveryCharge > 0) {
    extrasField += `Delivery & Packing (actuals): ₹${appliedDeliveryCharge}\n`;
  }

  const couponLabel = appliedCoupon || enteredCoupon || "";
  if (couponLabel) {
    if (discountAmount > 0) {
      extrasField += `Coupon Discount (${couponLabel}): -₹${discountAmount}\n`;
    } else {
      extrasField += `Coupon Applied (${couponLabel}): ₹0\n`;
    }
  } else if (discountAmount > 0) {
    extrasField += `Coupon Discount: -₹${discountAmount}\n`;
  }

  extrasField = extrasField.trim();

  const finalTotal = Math.max(subtotal - discountAmount + appliedDeliveryCharge, 0);
  const orderId = "RAY-" + Date.now();
  const locationPayload = capturedLocation
    ? {
        ...capturedLocation,
        distanceKm: deliveryDistanceKm || null,
        mapsUrl: `https://www.google.com/maps?q=${capturedLocation.lat},${capturedLocation.lng}`,
      }
    : null;

  /* ✅ API SAVE */
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        orderDate: new Date().toLocaleDateString("en-IN"),
        orderTime: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }),

        orderFor: getOrderForDateISO(),

        customer: customerName,
        phone: customerPhone,
        address: customerAddress,
        notes: customerNotes,

        items: itemsText.trim(),
        extras: extrasField,

        total: finalTotal,
        couponCode: appliedCoupon || enteredCoupon || "",
        couponDiscount: discountAmount || 0,
        location: locationPayload,
        locationUrl: locationPayload?.mapsUrl || "",
        deliveryDistanceKm: locationPayload?.distanceKm || null,
      }),
    });
  } catch (e) {
    console.warn("Order save failed", e);
  }

  /* ✅ WhatsApp MESSAGE */
  const message = `🧾 *New Order ${orderId}*
*Order For:* ${getOrderForLabel()}
(Date: ${getOrderForDateISO()})

*Name:* ${customerName}
*Phone:* ${customerPhone}
*Address:* ${customerAddress}${
    locationPayload?.mapsUrl ? `\nLocation: ${locationPayload.mapsUrl}` : ""
  }

*Items Ordered:*
${itemsText}

${extrasField ? `*Extras:*\n${extrasField}\n` : ""}
----------------------
Total: ₹${finalTotal}`;

  // Persist summary for thank-you page
  try {
    const summary = {
      orderId,
      orderFor: getOrderForLabel(),
      orderForDateISO: getOrderForDateISO(),
      name: customerName,
      phone: customerPhone,
      address: customerAddress,
      notes: customerNotes,
      items: itemsText.trim(),
      extras: extrasField,
      total: finalTotal,
      createdAt: new Date().toISOString(),
    };
    sessionStorage.setItem("LAST_ORDER", JSON.stringify(summary));
  } catch (_) {}

  waWindow.location.href =
    "https://wa.me/918850545924?text=" + encodeURIComponent(message);

  selectedItems = {};
  updateCart();
  renderMenu();

  // Redirect to thank-you page
  setTimeout(() => {
    window.location.href =
      "/thank-you.html?orderId=" + encodeURIComponent(orderId);
    const cart = document.getElementById("floating-cart");
    if (cart) cart.classList.add("cart-hidden");
  }, 300);
}

/* ---------- DATE HELPERS ---------- */
function getOrderForLabel() {
  const selected = new Date(window.ORDER_FOR_DATE);
  const today = new Date();

  today.setHours(0, 0, 0, 0);
  selected.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (selected - today) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";

  return selected.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function getOrderForDateISO() {
  const d = new Date(window.ORDER_FOR_DATE);
  d.setHours(0, 0, 0, 0);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- CART VISIBILITY ---------- */
function isMobileView() {
  return window.innerWidth <= 768;
}

function syncCartVisibility() {
  const count = Object.values(selectedItems).reduce((s, i) => s + i.qty, 0);

  const cart = document.getElementById("floating-cart");
  const toggle = document.getElementById("floating-cart-toggle");
  const countBadge = document.getElementById("cart-count");
  const hadItems = cartHasItems;

  if (!cart || !toggle || !countBadge) return;

  countBadge.textContent = count;

  const mobile = isMobileView();

  if (count === 0) {
    cart.style.display = "none";
    toggle.style.display = "none";
    cartHasItems = false;

    cartMinimized = false;
    cart.classList.remove("cart-hidden");
    return;
  }

  cartHasItems = true;
  if (!hadItems) lastScrollY = window.scrollY;
  if (count !== lastCartCount && count > 0) {
    toggle.classList.add("cart-toggle-pop");
    setTimeout(() => toggle.classList.remove("cart-toggle-pop"), 450);
  }
  lastCartCount = count;
  cart.style.display = "block";

  if (!mobile) {
    cartMinimized = false;
    cart.classList.remove("cart-hidden");
    toggle.style.display = "none";
    return;
  }

  cart.classList.toggle("cart-hidden", cartMinimized);
  toggle.style.display = cartMinimized ? "block" : "none";
  toggle.setAttribute("aria-expanded", (!cartMinimized).toString());

  const currentTotal =
    Number(
      (document.getElementById("cart-total")?.textContent || "").replace(
        /[^\d.]/g,
        ""
      )
    ) || 0;
  updateCartSummary(currentTotal, count);
}

function minimizeCart() {
  if (!cartHasItems) return;
  cartMinimized = true;
  syncCartVisibility();

  const total =
    Number(
      (document.getElementById("cart-total")?.textContent || "").replace(
        /[^\d.]/g,
        ""
      )
    ) || 0;
  const count = Object.values(selectedItems).reduce((s, i) => s + i.qty, 0);
  updateCartSummary(total, count);
}

function expandCart() {
  if (!cartHasItems) return;
  cartMinimized = false;
  syncCartVisibility();

  const total =
    Number(
      (document.getElementById("cart-total")?.textContent || "").replace(
        /[^\d.]/g,
        ""
      )
    ) || 0;
  const count = Object.values(selectedItems).reduce((s, i) => s + i.qty, 0);
  updateCartSummary(total, count);
}

function handleCartScroll() {
  const currentY = window.scrollY;

  if (!cartHasItems || !isMobileView()) {
    lastScrollY = currentY;
    return;
  }

  if (cartInteractionLocked) {
    lastScrollY = currentY;
    return;
  }

  const delta = currentY - lastScrollY;

  if (delta > 12 && !cartMinimized) {
    minimizeCart();
  }

  lastScrollY = currentY;
}

document.addEventListener("DOMContentLoaded", () => {
  initDeliveryCharge();
  setupFilters();
  setupParallax();
  setupCartTouch();
  setupCartFocusGuards();
});
window.addEventListener("scroll", handleCartScroll, { passive: true });
window.addEventListener("resize", syncCartVisibility);

function flashMenuItem(itemId) {
  const itemEl = document.querySelector(
    `.menu-item[data-item-key="${safeItemKey(itemId)}"]`
  );

  if (!itemEl) return;

  itemEl.classList.add("menu-item-flash");

  setTimeout(() => {
    itemEl.classList.remove("menu-item-flash");
  }, 650);
}

function setupFilters() {
  const searchInput = document.getElementById("search-dishes");
  const priceSelect = document.getElementById("price-filter");
  const vegBtn = document.getElementById("veg-toggle");
  const clearBtn = document.getElementById("clear-search");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderMenu();
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchQuery = "";
      renderMenu();
      searchInput.focus();
    });
  }

  if (priceSelect) {
    priceSelect.addEventListener("change", (e) => {
      priceFilter = e.target.value;
      renderMenu();
    });
  }

  if (vegBtn) {
    vegBtn.addEventListener("click", () => {
      vegOnly = !vegOnly;
      vegBtn.setAttribute("aria-pressed", vegOnly.toString());
      vegBtn.classList.toggle("active", vegOnly);
      renderMenu();
    });
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion?.matches) {
    document.documentElement.classList.add("reduce-motion");
  }
}

function updateCartProgress(amount, waived = false) {
  const wrap = document.getElementById("cart-progress");
  const fill = document.getElementById("cart-progress-fill");
  const value = document.getElementById("cart-progress-value");
  const msg = document.getElementById("cart-progress-msg");

  if (!wrap || !fill || !value || !msg) return;

  const goal = freeDeliveryTarget;

  const hasItems = Object.keys(selectedItems).length > 0;

  if (amount <= 0 || !hasItems) {
    wrap.style.display = "none";
    return;
  }

  if (goal === null) {
    wrap.style.display = hasItems ? "block" : "none";
    fill.style.width = "0%";
    value.textContent = "No free delivery for this distance";
    msg.textContent = locationAllowed
      ? "Delivery charges apply based on distance"
      : "Delivery charges shared at confirmation";
    if (discountAmount > 0 && appliedCoupon) {
      msg.textContent += ` · ${appliedCoupon} applied`;
    }
    return;
  }

  wrap.style.display = "block";
  const pct = Math.min(100, Math.round((amount / goal) * 100));
  fill.style.width = pct + "%";
  value.textContent = `₹${Math.round(amount)} / ₹${goal}`;

  const remaining = Math.max(goal - amount, 0);
  if (!locationAllowed) {
    msg.textContent = "Delivery charges shared at confirmation";
  } else if (remaining === 0 || waived) {
    msg.textContent = "Free delivery unlocked!";
  } else {
    msg.textContent = `Add ₹${remaining} more for free delivery`;
  }

  if (discountAmount > 0 && appliedCoupon) {
    msg.textContent += ` · ${appliedCoupon} applied`;
  }
}

function updateCartSummary(total, count) {
  const summary = document.getElementById("cart-mini-summary");
  if (!summary) return;

  if (!count) {
    summary.style.display = "none";
    return;
  }

  const mobile = isMobileView();
  summary.style.display = mobile && cartMinimized ? "flex" : "none";
  summary.textContent = `🍽️ ${count} item${count === 1 ? "" : "s"} · ₹${total}`;
  summary.onclick = expandCart;
}

function updateEtaLabel() {
  const etaEl = document.getElementById("cart-eta");
  if (!etaEl) return;

  const hasItems = Object.keys(selectedItems).length > 0;

  if (!hasItems) {
    etaEl.textContent = "";
    etaEl.style.display = "none";
    return;
  }

  const baseText =
    orderDay === "tomorrow"
      ? "Delivery scheduled for tomorrow"
      : orderType === "Lunch"
      ? "Estimated 35–50 mins"
      : "Estimated 45–60 mins";

  etaEl.textContent = baseText + (locationAllowed ? "" : " • ETA shared on confirm");
  etaEl.style.display = "block";
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.add("show");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
}

function setupParallax() {
  const overlay = document.querySelector(".header-overlay");
  if (!overlay) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const handle = () => {
    const y = window.scrollY;
    const limited = Math.min(y, 160);
    overlay.style.transform = `translateY(${limited * 0.2}px)`;
    overlay.style.opacity = String(Math.max(0.75, 1 - limited / 400));
  };

  window.addEventListener("scroll", handle, { passive: true });
  handle();
}

function setupCartTouch() {
  const cart = document.getElementById("floating-cart");
  if (!cart) return;

  cart.addEventListener("touchstart", handleCartTouchStart, { passive: true });
  cart.addEventListener("touchmove", handleCartTouchMove, { passive: true });
  cart.addEventListener("touchend", handleCartTouchEnd, { passive: true });
}

function handleCartTouchStart(e) {
  if (!isMobileView() || cartMinimized || !cartHasItems) return;
  if (!e.touches || !e.touches.length) return;
  if (cartInteractionLocked) return;

  cartTouchActive = true;
  cartTouchStartY = e.touches[0].clientY;
}

function handleCartTouchMove(e) {
  if (!cartTouchActive || !isMobileView() || cartMinimized) return;
  if (!e.touches || !e.touches.length) return;
  if (cartInteractionLocked) return;

  const currentY = e.touches[0].clientY;
  const deltaY = currentY - cartTouchStartY;

  const cartBody = document.querySelector("#floating-cart .cart-body");
  const atTop = !cartBody || cartBody.scrollTop <= 0;

  if (deltaY > 28 && atTop) {
    minimizeCart();
    cartTouchActive = false;
  }
}

function handleCartTouchEnd() {
  cartTouchActive = false;
}

function setupCartFocusGuards() {
  const cart = document.getElementById("floating-cart");
  if (!cart) return;

  const lock = () => {
    cartInteractionLocked = true;
    cartMinimized = false;
    syncCartVisibility();
  };

  const unlockSoon = () => {
    clearTimeout(cartFocusResetTimer);
    cartFocusResetTimer = setTimeout(() => {
      const active = document.activeElement;
      const stillInside = cart.contains(active) && isCartFormField(active);
      if (stillInside) return;
      cartInteractionLocked = false;
    }, 120);
  };

  cart.addEventListener("focusin", (e) => {
    if (!isCartFormField(e.target)) return;
    lock();
  });

  cart.addEventListener("focusout", (e) => {
    if (!isCartFormField(e.target)) return;
    unlockSoon();
  });
}

function isCartFormField(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

function showKitchenClosedBanner() {
  const banner = document.getElementById("kitchen-closed-banner");
  if (!banner) return;

  const shouldShow = kitchenClosedToday();
  banner.style.display = shouldShow ? "block" : "none";
  if (shouldShow) {
    banner.textContent =
      "🚫 Ordering for today is closed. We’re taking orders for tomorrow.";
  }
}

/* Allow calendar buttons to set day/date from index.html */
window.setOrderDay = function (day) {
  orderDay =
    kitchenClosedToday() || day === "tomorrow" ? "tomorrow" : "today";
  renderMenu();
  updateEtaLabel();
  syncCartVisibility();
  showKitchenClosedBanner();
};

window.setOrderDate = function (isoDate) {
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);

  if (isDateClosed(target)) {
    const next = findNextOpenDate(target);
    window.ORDER_FOR_DATE = next;
    if (typeof showToast === "function") {
      const label = next.getTime() === getTodayStart().getTime()
        ? "today"
        : next.getTime() === getTomorrowStart().getTime()
          ? "tomorrow"
          : next.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      showToast(`Selected date is closed. Switched to ${label}.`);
    }
  } else {
    window.ORDER_FOR_DATE = target;
  }

  syncOrderDayFromDate();
  if (typeof window.selectedDate !== "undefined") {
    window.selectedDate = new Date(window.ORDER_FOR_DATE);
  }
  if (typeof window.viewDate !== "undefined") {
    window.viewDate = new Date(window.ORDER_FOR_DATE);
  }
  renderMenu();
  updateEtaLabel();
  syncCartVisibility();
  showKitchenClosedBanner();
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof updateSelectedLabel === "function") updateSelectedLabel();
};

window.addEventListener("focus", () => {
  refreshKitchenState();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshKitchenState();
});
