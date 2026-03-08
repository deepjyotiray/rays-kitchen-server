/* ================= GLOBALS ================= */
window.ORDER_FOR_DATE = window.ORDER_FOR_DATE || new Date();

const API_URL = "https://api.healthymealspot.com/orders";
// const ORDER_FALLBACK_URL =
//   "https://script.google.com/macros/s/AKfycbzpV6819bR3ta2wkFGL7lpOcO-ZhbOZXUimcvR8XMSRHsAaq1zF7zMinjd82ukbq7ml/exec";
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
  customerNotes = "",
  currentUser = null;

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
let defaultSearchPlaceholder = "Search dishes, ingredients...";
// let sectionContextLabel = "";
let sectionContextRaf = false;
const TODAY_PREP_MINUTES = 60;
const FUTURE_WINDOWS = {
  Lunch: "1:30 – 3:30 PM",
  Dinner: "8:30 – 10:30 PM",
};

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatLocalDateISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatLocalTime(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatTime12(d = new Date()) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${pad2(m)} ${ampm}`;
}

function isPast9PM() {
  return new Date().getHours() >= 21;
}

function isDateClosed(date) {
  const day = getStartOfDay(date);
  if (day.getTime() === getTodayStart().getTime() && (kitchenClosedToday() || isPast9PM())) {
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

  // Use cached location from sessionStorage if available (avoids re-prompting on navigation)
  const cached = (() => { try { return JSON.parse(sessionStorage.getItem('_loc')); } catch { return null; } })();
  if (cached && cached.lat) {
    capturedLocation = cached.loc;
    deliveryCharge = cached.deliveryCharge;
    deliveryDistanceKm = cached.deliveryDistanceKm || 0;
    freeDeliveryTarget = cached.freeDeliveryTarget !== undefined ? cached.freeDeliveryTarget : freeDeliveryTarget;
    baseFreeDeliveryTarget = freeDeliveryTarget;
    if (cached.blocked) {
      locationAllowed = false;
      showLocationBlockedBanner(cached.blockedMsg || undefined);
    }
    updateCart();
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
    try { sessionStorage.setItem('_loc', JSON.stringify({ lat: 0, blocked: true, deliveryCharge, freeDeliveryTarget: null })); } catch {}
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
    if (deliveryDistanceKm > 5) {
      locationAllowed = false;
      const blockedMsg = "Sorry, we only deliver within 5 km. Your location is " + deliveryDistanceKm.toFixed(1) + " km away.";
      try { sessionStorage.setItem('_loc', JSON.stringify({ lat: capturedLocation.lat, loc: capturedLocation, deliveryCharge, deliveryDistanceKm, freeDeliveryTarget: null, blocked: true, blockedMsg })); } catch {}
      showLocationBlockedBanner(blockedMsg);
      updateCart();
      return;
    }
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

  try { sessionStorage.setItem('_loc', JSON.stringify({ lat: capturedLocation.lat, loc: capturedLocation, deliveryCharge, deliveryDistanceKm, freeDeliveryTarget })); } catch {}
  updateCart();
}

function showLocationBlockedBanner(msg) {
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

    banner.innerHTML = msg
      ? `📍 ${msg}`
      : `📍 Location access not provided.<br>Delivery charges will be added as per actuals.`;

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

// function formatMinutes(mins) {
//   const h = Math.floor(mins / 60);
//   const m = mins % 60;
//   if (h <= 0) return `${m}m`;
//   if (m === 0) return `${h}h`;
//   return `${h}h ${m}m`;
// }

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
      // const next = findNextOpenDate(new Date(maybeClosed.getTime() + 86400000));
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
    // Try API first for dynamic menu with macros
    const apiUrl = isCorporatePage ? 
      "https://api.healthymealspot.com/menu?type=corporate" : 
      "https://api.healthymealspot.com/menu?type=main";
    
    const apiRes = await fetch(apiUrl);
    if (apiRes.ok) {
      const apiData = await apiRes.json();
      menuData = apiData.menu || apiData;
      renderMenu();
      return;
    }
  } catch (err) {
    console.warn("API menu load failed, falling back to JSON:", err);
  }
  
  // Fallback to JSON file
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
  // If past 9 PM, pre-select tomorrow
  window.ORDER_FOR_DATE = isPast9PM() ? getTomorrowStart() : getTodayStart();
  syncOrderDayFromDate();
  try {
    await refreshKitchenState();
  } catch (e) {
    console.warn("Kitchen state load failed", e);
  }
  await fetchMenuData();
  await loadExistingUser();
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
    // Skip unavailable sections
    if (s.available === false) return;
    
    const available = isSectionAvailable(k);
    const collapsed = true;

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
            // const minusDisabledAttr =
              !available || qty <= 0 ? "disabled" : "";
            const plusDisabledAttr = !available ? "disabled" : "";
            const plusActiveClass =
              qty > 0 && available ? " qty-plus-active" : "";

            return `
              <div class="menu-item ${!available ? "disabled" : ""} ${
              inCart ? "menu-item-in-cart" : ""
            }" data-item-key="${itemDomKey}" ${i.calories ? `data-calories="${i.calories}" data-protein="${i.protein || 0}" data-carbs="${i.carbs || 0}" data-fat="${i.fat || 0}"` : ''}>
                <div class="item-content">
                  <div class="item-indicator-top">
                    <span class="food-indicator ${
                      i.veg ? "veg" : "non-veg"
                    }"></span>
                  </div>
                  <div class="item-name">
                    ${i.name}
                  </div>

                  <div class="item-desc">${i.description || ''}</div>

                  <div class="item-price-row">
                    <div class="item-price">
                      ${
                        k === "SeaFood_starters"
                          ? "Market Price"
                          : `Rs. ${i.price}`
                      }
                    </div>
                    <div class="qty-box">
                      ${qty === 0 ?
                        `<button class="add-btn" data-item-key="${itemDomKey}" data-available="${available}" data-item-id="${itemDomKey}" ${plusDisabledAttr} aria-label="Add">
                          <span class="add-text">ADD</span>
                          <span class="add-plus">+</span>
                        </button>` :
                        `<div class="qty-control" data-item-key="${itemDomKey}" data-available="${available}">
                        <span class="qty-minus" data-item-id="${itemDomKey}">\u2212</span>
                        <span class="qty-count">${qty}</span>
                        <span class="qty-plus" data-item-id="${itemDomKey}">+</span>
                        </div>`
                      }
                    </div>
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
                                    data-item-id="${itemDomKey}"
                                    data-extra-name="${encodeURIComponent(ex.item)}"
                                    data-extra-price="${Number(ex.price)}">
                                  ${ex.item} (+\u20b9${ex.price})
                                </label>
                              `
                            )
                            .join("")}
                        </div>
                      `
                      : ""
                  }
                </div>

                <div class="item-macros">${i.calories ? `${(i.protein && i.protein >= 20) ? '<span class="high-protein-icon" title="High Protein">💪</span> ' : ''}${i.calories}kcal • ${i.protein || 0}g protein • ${i.carbs || 0}g carbs • ${i.fat || 0}g fat` : ''}</div>
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
  updateSectionContext();
  if (c._menuEventsController) c._menuEventsController.abort();
  const controller = new AbortController();
  c._menuEventsController = controller;
  bindMenuItemEvents(c, controller.signal);
}

function bindMenuItemEvents(container, signal) {
  const opts = signal ? { signal } : {};
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".add-btn[data-item-id]");
    if (btn) {
      const domKey = btn.dataset.itemId;
      const itemEl = btn.closest(".menu-item");
      if (!itemEl) return;
      const [sectionKey] = domKey.split("__");
      const realId = Object.keys(menuData).reduce((found, k) => {
        if (found) return found;
        const item = (menuData[k]?.items || []).find(i => safeItemKey(`${k}__${i.name}`) === domKey);
        return item ? `${k}__${item.name}` : null;
      }, null);
      if (!realId) return;
      const [sk, ...nameParts] = realId.split("__");
      const itemName = nameParts.join("__");
      const menuItem = (menuData[sk]?.items || []).find(i => i.name === itemName);
      if (menuItem) updateQty(realId, menuItem.name, menuItem.price, 1);
      return;
    }
    const minus = e.target.closest(".qty-minus[data-item-id]");
    const plus = e.target.closest(".qty-plus[data-item-id]");
    const target = minus || plus;
    if (target) {
      const domKey = target.dataset.itemId;
      const realId = Object.keys(menuData).reduce((found, k) => {
        if (found) return found;
        const item = (menuData[k]?.items || []).find(i => safeItemKey(`${k}__${i.name}`) === domKey);
        return item ? `${k}__${item.name}` : null;
      }, null);
      if (!realId) return;
      const [sk, ...nameParts] = realId.split("__");
      const itemName = nameParts.join("__");
      const menuItem = (menuData[sk]?.items || []).find(i => i.name === itemName);
      if (menuItem) updateQty(realId, menuItem.name, menuItem.price, minus ? -1 : 1);
    }
  }, opts);
  container.addEventListener("change", (e) => {
    const input = e.target.closest("input[data-item-id][data-extra-name]");
    if (!input) return;
    const domKey = input.dataset.itemId;
    const extraName = decodeURIComponent(input.dataset.extraName);
    const extraPrice = Number(input.dataset.extraPrice);
    const realId = Object.keys(menuData).reduce((found, k) => {
      if (found) return found;
      const item = (menuData[k]?.items || []).find(i => safeItemKey(`${k}__${i.name}`) === domKey);
      return item ? `${k}__${item.name}` : null;
    }, null);
    if (realId) toggleExtra(realId, extraName, extraPrice, input.checked);
  }, opts);
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
  
  // Dispatch cart update event for MOTD
  if (typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent('cartUpdated', { detail: { itemId: id, qty: selectedItems[id]?.qty || 0 } }));
  }
}

function updateMenuQtyUI(itemId) {
  const qty = selectedItems[itemId]?.qty || 0;
  const domKey = safeItemKey(itemId);
  const qtyBox = document.querySelector(
    `.menu-item[data-item-key="${domKey}"] .qty-box`
  );
  
  if (qtyBox) {
    const available = qtyBox.querySelector('[data-available]')?.dataset.available !== 'false';
    
    // Get item details from menu data
    const [sectionKey, itemName] = itemId.split('__');
    const section = menuData[sectionKey];
    const menuItem = section?.items?.find(item => item.name === itemName);
    const itemName2 = menuItem?.name || '';
    const itemPrice = menuItem?.price || 0;
    
    qtyBox.innerHTML = "";
    if (qty === 0) {
      const btn = document.createElement("button");
      btn.className = "add-btn";
      btn.dataset.available = available;
      if (!available) btn.disabled = true;
      btn.setAttribute("aria-label", "Add item");
      btn.innerHTML = '<span class="add-text">ADD</span><span class="add-plus">+</span>';
      btn.addEventListener("click", () => updateQty(itemId, itemName2, itemPrice, 1));
      qtyBox.appendChild(btn);
    } else {
      const ctrl = document.createElement("div");
      ctrl.className = "qty-control";
      ctrl.dataset.available = available;
      const minus = document.createElement("span");
      minus.className = "qty-minus";
      minus.textContent = "\u2212";
      minus.addEventListener("click", () => updateQty(itemId, itemName2, itemPrice, -1));
      const count = document.createElement("span");
      count.className = "qty-count";
      count.textContent = qty;
      const plus = document.createElement("span");
      plus.className = "qty-plus";
      plus.textContent = "+";
      plus.addEventListener("click", () => updateQty(itemId, itemName2, itemPrice, 1));
      ctrl.append(minus, count, plus);
      qtyBox.appendChild(ctrl);
    }
  }

  const itemEl = document.querySelector(
    `.menu-item[data-item-key="${domKey}"]`
  );
  if (itemEl) itemEl.classList.toggle("menu-item-in-cart", qty > 0);
}

/* ---------- SECTION CONTEXT (FLOATING LABEL) ---------- */
function bindSectionContextListeners() {
  window.addEventListener("scroll", handleSectionContextScroll, {
    passive: true,
  });
  handleSectionContextScroll();
}

function handleSectionContextScroll() {
  if (sectionContextRaf) return;
  sectionContextRaf = true;
  requestAnimationFrame(() => {
    updateSectionContext();
    sectionContextRaf = false;
  });
}

function getActiveSectionContext() {
  const sections = Array.from(
    document.querySelectorAll("#menu-container section")
  );
  if (!sections.length) return { label: "" };

  const filterBar = document.querySelector(".filter-bar");
  const anchor = (filterBar?.getBoundingClientRect().bottom || 0) + 6;

  let best = sections[0];
  let bestDelta = Infinity;

  sections.forEach((sec) => {
    const rect = sec.getBoundingClientRect();
    const delta = rect.top - anchor;
    const score = Math.abs(delta);
    if (score < Math.abs(bestDelta) || (score === Math.abs(bestDelta) && delta < bestDelta)) {
      best = sec;
      bestDelta = delta;
    }
  });

  const titleEl = best.querySelector(".section-header h2");
  const label = titleEl ? titleEl.textContent.trim() : best.id || "";

  return { label };
}

function updateSectionContext() {
  const ctx = document.getElementById("section-context");
  const searchInput = document.getElementById("search-dishes");
  if (!ctx || !searchInput) return;

  const { label } = getActiveSectionContext();

  if (label) {
    ctx.textContent = label;
    if (!searchInput.value) {
      searchInput.placeholder = `Search • ${label}`;
    }
  } else {
    ctx.textContent = "";
    if (!searchInput.value) {
      searchInput.placeholder = defaultSearchPlaceholder;
    }
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

    const row = document.createElement("div");
    row.className = `cart-row${highlightClass}`;

    const cartItem = document.createElement("div");
    cartItem.className = "cart-item";
    const title = document.createElement("div");
    title.className = "cart-item-title";
    title.textContent = i.name;
    cartItem.appendChild(title);
    if (i.extras && Object.keys(i.extras).length) {
      const extrasEl = document.createElement("div");
      extrasEl.className = "cart-item-extras";
      extrasEl.textContent = Object.keys(i.extras).map((n) => `+ ${n}`).join(", ");
      cartItem.appendChild(extrasEl);
    }

    const rate = document.createElement("div");
    rate.className = "cart-rate";
    rate.textContent = `\u20b9${i.price}`;

    const qtyDiv = document.createElement("div");
    qtyDiv.className = "cart-qty";
    const minusBtn = document.createElement("button");
    minusBtn.textContent = "\u2212";
    minusBtn.addEventListener("click", () => updateQty(itemId, i.name, i.price, -1));
    const qtySpan = document.createElement("span");
    qtySpan.textContent = i.qty;
    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", () => updateQty(itemId, i.name, i.price, 1));
    qtyDiv.append(minusBtn, qtySpan, plusBtn);

    row.append(cartItem, rate, qtyDiv);
    c.appendChild(row);
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

    const deliveryRow = document.createElement("div");
    deliveryRow.className = "cart-row";
    deliveryRow.innerHTML = `<span class="delivery-label">🚚 Delivery:</span><span class="cart-rate">${deliveryLabel}</span>`;
    c.appendChild(deliveryRow);
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

/* ---------- STREAMLINED USER FLOW ---------- */
window.proceedWithMobile = async function() {
  const mobileEl = document.getElementById("reg-mobile");
  mobileEl.readOnly = false;
  const mobile = mobileEl.value.trim();
  
  if (!mobile) {
    alert("Please enter your mobile number");
    return;
  }
  
  try {
    // First, try to find existing user
    const res = await fetch(`https://api.healthymealspot.com/users/${mobile}`);
    
    if (res.ok) {
      // User exists - login directly
      const data = await res.json();
      currentUser = data.user;
      customerName = currentUser.name;
      customerPhone = currentUser.mobile;
      customerAddress = currentUser.address || "";
      
      localStorage.setItem("user_mobile", mobile);
      if (data.token) localStorage.setItem("user_token", data.token);
      showOrderStep();
      
      if (typeof showToast === "function") {
        showToast(`Welcome back, ${currentUser.name}!`);
      }
    } else if (res.status === 404) {
      // User doesn't exist - show name field and register
      document.getElementById("reg-name").style.display = "block";
      document.getElementById("reg-name").focus();
      
      // Change button to register
      const continueBtn = document.getElementById("reg-continue-btn");
      continueBtn.textContent = "Register";
      continueBtn.onclick = registerNewUser;
      
      if (typeof showToast === "function") {
        showToast("Please enter your name to complete registration");
      }
    } else {
      throw new Error("Server error");
    }
  } catch (e) {
    console.error("Error checking user:", e);
    alert("Something went wrong. Please try again.");
  }
};

window.registerNewUser = async function() {
  const name = document.getElementById("reg-name").value.trim();
  const mobile = document.getElementById("reg-mobile").value.trim().replace(/^\+91/, '');
  
  if (!name) {
    alert("Please enter your name");
    return;
  }
  
  try {
    const res = await fetch("https://api.healthymealspot.com/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mobile })
    });
    
    if (!res.ok) throw new Error("Registration failed");
    
    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;
    customerPhone = currentUser.mobile;
    customerAddress = currentUser.address || "";
    
    localStorage.setItem("user_mobile", mobile);
    if (data.token) localStorage.setItem("user_token", data.token);
    showOrderStep();
    
    if (typeof showToast === "function") {
      showToast("Registration successful!");
    }
  } catch (e) {
    console.error("Registration error:", e);
    alert("Registration failed. Please try again.");
  }
};

window.editUser = function() {
  showRegistrationStep();
  const nameEl = document.getElementById("reg-name");
  const mobileEl = document.getElementById("reg-mobile");
  const continueBtn = document.getElementById("reg-continue-btn");

  if (currentUser) {
    nameEl.value = currentUser.name;
    nameEl.style.display = "block";
    nameEl.focus();
    mobileEl.value = currentUser.mobile;
    mobileEl.style.display = 'none';
  }
  continueBtn.textContent = "Update Name";
  continueBtn.onclick = updateUser;
};



window.updateUser = async function() {
  const name = document.getElementById("reg-name").value.trim();
  const mobile = currentUser ? currentUser.mobile : customerPhone;

  if (!name) {
    alert("Please enter your name");
    return;
  }

  try {
    const res = await fetch("https://api.healthymealspot.com/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mobile, address: currentUser?.address || "" })
    });

    if (!res.ok) throw new Error("Update failed");

    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;

    showOrderStep();

    if (typeof showToast === "function") {
      showToast("Name updated successfully!");
    }
  } catch (e) {
    console.error("Update error:", e);
    alert("Update failed. Please try again.");
  }
};

window.showMyOrders = async function() {
  if (!currentUser) {
    if (typeof showToast === "function") {
      showToast("Please login first to view your orders");
    }
    return;
  }
  
  try {
    const res = await fetch(`https://api.healthymealspot.com/users/${currentUser.mobile}/orders`);
    
    if (!res.ok) {
      throw new Error("Failed to fetch orders");
    }
    
    const data = await res.json();
    const orders = data.orders || [];
    
    if (orders.length === 0) {
      if (typeof showToast === "function") {
        showToast("No orders found");
      }
      return;
    }
    
    // Create and show orders modal
    let ordersModal = document.getElementById("orders-modal");
    if (!ordersModal) {
      ordersModal = document.createElement("div");
      ordersModal.id = "orders-modal";
      ordersModal.className = "modal";
      document.body.appendChild(ordersModal);
    }
    
    const grouped = orders.reduce((acc, order) => {
      const d = new Date(order.order_date);
      const key = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      (acc[key] ||= []).push(order);
      return acc;
    }, {});

        // Build orders modal with DOM APIs to prevent XSS
    ordersModal.innerHTML = "";
    const _mc = document.createElement("div");
    _mc.className = "modal-content";
    const _mh = document.createElement("div");
    _mh.className = "modal-header";
    const _h3 = document.createElement("h3");
    _h3.textContent = "My Orders";
    const _cb = document.createElement("button");
    _cb.className = "close-btn";
    _cb.textContent = "×";
    _cb.onclick = () => closeOrdersModal();
    _mh.append(_h3, _cb);
    const _ol = document.createElement("div");
    _ol.className = "orders-list";
    Object.entries(grouped).forEach(([month, monthOrders]) => {
      const _g = document.createElement("div");
      _g.className = "orders-month-group";
      const _gh = document.createElement("div");
      _gh.className = "orders-month-header";
      _gh.textContent = month;
      _g.appendChild(_gh);
      monthOrders.forEach(order => {
        const _oi = document.createElement("div");
        _oi.className = "order-item";
        const _oh = document.createElement("div");
        _oh.className = "order-header";
        const _st = document.createElement("strong");
        _st.textContent = String(order.id || "");
        const _ds = document.createElement("span");
        _ds.className = "order-date";
        _ds.textContent = new Date(order.order_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        _oh.append(_st, _ds);
        const _det = document.createElement("div");
        _det.className = "order-details";
        ["Order For: " + (order.order_for || "N/A"), "Total: ₹" + order.total, "Status: " + (order.status || "Confirmed")].forEach(t => {
          const _d = document.createElement("div"); _d.textContent = t; _det.appendChild(_d);
        });
        const _it = document.createElement("div");
        _it.className = "order-items";
        _it.textContent = String(order.items || "");
        const _rb = document.createElement("button");
        _rb.className = "repeat-order-btn";
        _rb.textContent = "➕ Add to Current Order";
        _rb.addEventListener("click", () => addOrderToCart(order.id, order.items || ""));
        _oi.append(_oh, _det, _it, _rb);
        _g.appendChild(_oi);
      });
      _ol.appendChild(_g);
    });
    _mc.append(_mh, _ol);
    ordersModal.appendChild(_mc);
    ordersModal.classList.add("show");
    
  } catch (e) {
    console.error("Error fetching orders:", e);
    if (typeof showToast === "function") {
      showToast("Failed to load orders. Please try again.");
    }
  }
};

window.closeOrdersModal = function() {
  const modal = document.getElementById("orders-modal");
  if (modal) {
    modal.classList.remove("show");
  }
};

window.addOrderToCart = function(orderId, itemsText) {
  try {
    // Parse items from order text (format: "• Item x Qty = ₹Price")
    const lines = itemsText.split('\n').filter(line => line.trim().startsWith('•'));
    let addedCount = 0;
    
    lines.forEach(line => {
      const match = line.match(/• (.+?) x (\d+)(?:\s*\([^)]+\))? = ₹(\d+)/);
      if (match) {
        const [, itemName, qty, price] = match;
        const quantity = parseInt(qty);
        const itemPrice = parseInt(price) / quantity; // Get unit price
        
        // Find matching menu item
        let found = false;
        Object.entries(menuData).forEach(([sectionKey, section]) => {
          if (found) return;
          const menuItem = section.items?.find(item => 
            item.name.toLowerCase().trim() === itemName.toLowerCase().trim()
          );
          if (menuItem) {
            const itemId = `${sectionKey}__${menuItem.name}`;
            // Add to cart
            for (let i = 0; i < quantity; i++) {
              updateQty(itemId, menuItem.name, menuItem.price, 1);
            }
            addedCount++;
            found = true;
          }
        });
      }
    });
    
    closeOrdersModal();
    
    if (addedCount > 0) {
      if (typeof showToast === "function") {
        showToast(`${addedCount} items added to your current order`);
      }
      // Close any open modals and show cart for review
      closeCustomerModal();
      setTimeout(() => {
        expandCart();
      }, 300);
    } else {
      if (typeof showToast === "function") {
        showToast("No matching items found in current menu");
      }
    }
  } catch (e) {
    console.error('Error adding order to cart:', e);
    if (typeof showToast === "function") {
      showToast("Error adding items to cart");
    }
  }
};

window.repeatOrder = function(orderId) {
  const waWindow = window.open("", "_blank");
  const message = `Hi! I'd like to repeat my previous order ${orderId}. Please confirm the items and total.`;
  waWindow.location.href = "https://wa.me/919326492088?text=" + encodeURIComponent(message);
  closeOrdersModal();
};

window.submitBulkOrder = async function() {
  const name = document.getElementById('bulk-name').value.trim();
  const mobile = document.getElementById('bulk-mobile').value.trim().replace(/^\+91/, '');
  const address = document.getElementById('bulk-address').value.trim();
  const dates = document.getElementById('bulk-dates').value.trim();
  const requirements = document.getElementById('bulk-requirements').value.trim();

  if (!name || !mobile || !address || !dates) {
    alert('Please fill all required fields');
    return;
  }

  const btn = document.querySelector('#bulk-order-modal .primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const res = await fetch('https://api.healthymealspot.com/bulk-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mobile, address, dates, requirements })
    });

    if (!res.ok) throw new Error('Failed to submit');

    closeBulkOrderModal();
    if (typeof showToast === 'function') showToast('Bulk order request submitted successfully!');

    ['bulk-name','bulk-mobile','bulk-address','bulk-dates','bulk-requirements']
      .forEach(id => { document.getElementById(id).value = ''; });
  } catch (e) {
    alert('Failed to submit request. Please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Request'; }
  }
};

window.closeBulkOrderModal = function() {
  document.getElementById('bulk-order-modal').classList.remove('show');
};

function showRegistrationStep() {
  document.getElementById("registration-step").style.display = "block";
  document.getElementById("order-step").style.display = "none";
  
  // Reset form to initial state
  document.getElementById("reg-name").style.display = "none";
  document.getElementById("reg-name").value = "";
  document.getElementById("reg-mobile").value = "";
  
  const continueBtn = document.querySelector("#registration-step button");
  continueBtn.textContent = "Continue";
  continueBtn.onclick = proceedWithMobile;
}

function showOrderStep() {
  document.getElementById("registration-step").style.display = "none";
  document.getElementById("order-step").style.display = "flex";
  
  const userDisplay = document.getElementById("user-display");
  if (userDisplay && currentUser) {
    userDisplay.textContent = currentUser.name;
  }
  
  const addressField = document.getElementById("cust-address");
  if (addressField && currentUser && currentUser.address) {
    addressField.value = currentUser.address;
  }
}

async function loadExistingUser() {
  const savedMobile = localStorage.getItem("user_mobile");
  if (!savedMobile) return;
  
  try {
    const res = await fetch(`https://api.healthymealspot.com/users/${savedMobile}`);
    if (!res.ok) return;
    
    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;
    customerPhone = currentUser.mobile;
    customerAddress = currentUser.address || "";
    if (data.token) localStorage.setItem("user_token", data.token);
  } catch (e) {
    console.warn("Failed to load existing user:", e);
  }
}

/* ---------- ORDERING ---------- */
window.orderOnWhatsApp = function () {
  if (!Object.keys(selectedItems).length) return;
  if (kitchenClosedToday() && orderDay === "today") {
    showToast("Ordering for today is closed. Please switch to tomorrow.");
    return;
  }
  
  fetch('/api/auth/session')
    .then(r => r.json())
    .then(data => {
      if (data.authenticated) {
        customerPhone = data.mobile;
        loadUserAndShowOrder(data.mobile);
      } else {
        showOTPModal();
      }
    });
};

async function loadUserAndShowOrder(mobile) {
  try {
    const res = await fetch(`/users/${mobile}`);
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      customerName = currentUser.name;
      customerPhone = currentUser.mobile;
      customerAddress = currentUser.address || '';
    }
  } catch (e) {
    console.warn('Failed to load user:', e);
  }
  
  syncOrderTypeRadios();
  updateExpectedDeliveryUI();
  
  const logoutLink = document.getElementById('logout-link');
  const mobileDisplay = document.getElementById('mobile-display');
  
  if (logoutLink) {
    logoutLink.style.display = 'inline';
  }
  
  if (mobileDisplay) {
    mobileDisplay.textContent = mobile;
    mobileDisplay.style.display = 'block';
  }
  
  if (currentUser) {
    document.getElementById('registration-step').style.display = 'none';
    document.getElementById('order-step').style.display = 'flex';
    document.getElementById('new-user-name').style.display = 'none';
    document.getElementById('user-display').style.display = 'block';
    document.getElementById('user-display').textContent = currentUser.name;
    if (currentUser.address) {
      document.getElementById('cust-address').value = currentUser.address;
    }
  } else {
    document.getElementById('registration-step').style.display = 'none';
    document.getElementById('order-step').style.display = 'flex';
    document.getElementById('new-user-name').style.display = 'block';
    document.getElementById('new-user-name').value = '';
    document.getElementById('user-display').style.display = 'none';
    document.getElementById('cust-address').value = '';
  }

  // Only open checkout modal if there are items in the cart
  if (Object.keys(selectedItems).length > 0) {
    document.getElementById('customer-modal').classList.add('show');
    document.body.classList.add('modal-open');
  } else {
    if (typeof showToast === 'function') showToast('Welcome back, ' + (currentUser?.name || mobile) + '!');
    if (typeof syncDrawerUser === 'function') syncDrawerUser();
  }
}

window.logout = async function() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  
  currentUser = null;
  customerName = '';
  customerPhone = '';
  customerAddress = '';
  
  closeCustomerModal();
  
  const modal = document.getElementById('otp-modal');
  if (modal) {
    document.getElementById('otp-mobile-step').style.display = 'block';
    document.getElementById('otp-verify-step').style.display = 'none';
    document.getElementById('otp-mobile').value = '';
    document.getElementById('otp-code').value = '';
    const msgDiv = document.getElementById('otp-message');
    msgDiv.innerHTML = '';
    msgDiv.style.background = '';
    msgDiv.style.color = '';
    modal.classList.add('show');
  } else {
    showOTPModal();
  }
};

function showOTPModal() {
  window.otpCalledFrom = 'order';
  let modal = document.getElementById('otp-modal');
  if (!modal) {
    const html = `
<div id="otp-modal" class="otp-modal-overlay">
  <div class="otp-modal-content">
    <div class="otp-header">Verify Mobile Number</div>
    <div id="otp-mobile-step">
      <input type="tel" id="otp-mobile" class="otp-input" placeholder="Enter 10-digit mobile" maxlength="10" inputmode="numeric">
      <div id="otp-message" class="otp-message"></div>
      <div class="otp-actions">
        <button type="button" id="otp-send-btn" class="otp-btn otp-btn-primary">Send OTP</button>
        <button type="button" id="otp-cancel-btn" class="otp-btn otp-btn-secondary" onclick="closeOTPModal()">Cancel</button>
      </div>
    </div>
    <div id="otp-verify-step" style="display:none">
      <input type="text" id="otp-code" class="otp-input" placeholder="Enter 6-digit OTP" maxlength="6" inputmode="numeric">
      <div class="otp-actions">
        <button type="button" id="otp-verify-btn" class="otp-btn otp-btn-primary">Verify</button>
        <button type="button" id="otp-reset-btn" class="otp-btn otp-btn-secondary">Change Number</button>
      </div>
    </div>
  </div>
</div>
`;
    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.getElementById('otp-modal');
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeOTPModal();
    });
    document.getElementById('otp-send-btn').addEventListener('click', sendOTP);
    document.getElementById('otp-cancel-btn').addEventListener('click', closeOTPModal);
    document.getElementById('otp-verify-btn').addEventListener('click', verifyOTP);
    document.getElementById('otp-reset-btn').addEventListener('click', resetOTP);
  }
  modal.classList.add('show');
}

window.closeOTPModal = function() {
  const modal = document.getElementById('otp-modal');
  if (modal) modal.classList.remove('show');
};

window.showOTPModalForChat = function() {
  showOTPModal();
};

window.sendOTP = async function() {
  const mobile = document.getElementById('otp-mobile').value.trim();
  
  if (!/^[0-9]{10}$/.test(mobile)) {
    showOTPMessage('Enter valid 10-digit mobile', 'error');
    return;
  }
  
  if (mobile === '9594614752') {
    showOTPMessage('Admin mode - Enter customer mobile', 'success');
    document.getElementById('otp-mobile-step').style.display = 'none';
    document.getElementById('otp-verify-step').innerHTML = `
      <input type="tel" id="customer-mobile" class="otp-input" placeholder="Enter customer mobile (10 digits)" maxlength="10">
      <div class="otp-actions">
        <button onclick="adminPlaceOrder()" class="otp-btn otp-btn-primary">Continue</button>
        <button onclick="closeOTPModal()" class="otp-btn otp-btn-secondary">Cancel</button>
      </div>
    `;
    document.getElementById('otp-verify-step').style.display = 'block';
    return;
  }
  
  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile })
    });
    const data = await res.json();
    
    if (data.success) {
      document.getElementById('otp-mobile-step').style.display = 'none';
      document.getElementById('otp-verify-step').style.display = 'block';
    } else {
      showOTPMessage(data.error || 'Failed to send OTP', 'error');
    }
  } catch (err) {
    showOTPMessage('Network error', 'error');
  }
};

window.verifyOTP = async function() {
  const mobile = document.getElementById('otp-mobile').value.trim();
  const otp = document.getElementById('otp-code').value.trim();
  
  if (!/^[0-9]{6}$/.test(otp)) {
    showOTPMessage('Enter valid 6-digit OTP', 'error');
    return;
  }
  
  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, otp })
    });
    const data = await res.json();
    
    if (data.success) {
      customerPhone = mobile;
      closeOTPModal();
      resetOTPModal();
      await loadUserAndShowOrder(mobile);
    } else {
      showOTPMessage(data.error || 'Invalid OTP', 'error');
    }
  } catch (err) {
    showOTPMessage('Network error', 'error');
  }
};

window.resetOTP = function() {
  document.getElementById('otp-mobile-step').style.display = 'block';
  document.getElementById('otp-verify-step').style.display = 'none';
  document.getElementById('otp-mobile').value = '';
  document.getElementById('otp-code').value = '';
  const msgDiv = document.getElementById('otp-message');
  msgDiv.innerHTML = '';
  msgDiv.style.background = '';
  msgDiv.style.color = '';
};

function resetOTPModal() {
  document.getElementById('otp-mobile-step').style.display = 'block';
  document.getElementById('otp-verify-step').style.display = 'none';
  document.getElementById('otp-mobile').value = '';
  document.getElementById('otp-code').value = '';
  const msgDiv = document.getElementById('otp-message');
  msgDiv.innerHTML = '';
  msgDiv.style.background = '';
  msgDiv.style.color = '';
}

function showOTPMessage(msg, type) {
  const div = document.getElementById('otp-message');
  div.textContent = msg;
  div.style.background = type === 'error' ? '#fee' : '#efe';
  div.style.color = type === 'error' ? '#c00' : '#060';
}

window.adminPlaceOrder = async function() {
  const customerMobile = document.getElementById('customer-mobile').value.trim();
  if (!/^[0-9]{10}$/.test(customerMobile)) {
    showOTPMessage('Enter valid customer mobile', 'error');
    return;
  }
  
  customerPhone = customerMobile;
  closeOTPModal();
  await loadUserAndShowOrder(customerMobile);
};

window.closeCustomerModal = () => {
  document.getElementById("customer-modal").classList.remove("show");
  document.body.classList.remove("modal-open");
};

// Add escape key listener
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById("customer-modal");
    if (modal && modal.classList.contains("show")) {
      closeCustomerModal();
    }
  }
});

window.confirmOrder = async function () {
  const nameField = document.getElementById('new-user-name');
  const isNewUser = nameField.style.display !== 'none';
  
  if (isNewUser) {
    const name = nameField.value.trim();
    if (!name) {
      alert('Please enter your name');
      return;
    }
    customerName = name;
  }
  
  customerAddress = document.getElementById("cust-address").value.trim();
  customerNotes = document.getElementById("cust-notes").value.trim();

  if (!customerAddress) {
    alert("Please enter delivery address");
    return;
  }

  if (kitchenClosedToday() && orderDay === "today") {
    showToast("Ordering for today is closed. Please pick tomorrow.");
    return;
  }

  if (!locationAllowed) {
    const confirmBtn = document.querySelector("#order-step .primary");
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Checking address…"; }
    try {
      const res = await fetch("/api/geocode-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: customerAddress })
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Could not verify your address. Please enable location access or enter a more detailed address.");
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Place Order"; }
        return;
      }
      if (data.withinRange === false) {
        alert(`Sorry, we currently deliver within 5 km only. Your address appears to be ~${data.distanceKm} km away.`);
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Place Order"; }
        return;
      }
      if (data.withinRange === null) {
        console.warn("Geocode: address not found, allowing order");
      }
    } catch (e) {
      console.warn("Geocode check failed, proceeding:", e);
    } finally {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Place Order"; }
    }
  }

  if (isNewUser) {
    await fetch("https://api.healthymealspot.com/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: customerName,
        mobile: customerPhone,
        address: customerAddress
      })
    });
  } else if (currentUser && customerAddress !== currentUser.address) {
    updateUserAddress(customerAddress);
  }

  closeCustomerModal();
  setTimeout(() => placeFinalOrder(), 50);
};

async function updateUserAddress(address) {
  if (!currentUser) return;
  
  try {
    await fetch("https://api.healthymealspot.com/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: currentUser.name,
        mobile: currentUser.mobile,
        address: address
      })
    });
    currentUser.address = address;
  } catch (e) {
    console.warn("Failed to update user address:", e);
  }
}

async function persistOrder(payload) {
  // Primary: backend API
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("PRIMARY_SAVE_FAILED_" + res.status);
    return true;
  } catch (err) {
    console.warn("Primary order save failed", err);
  }

  // Fallback: Google Apps Script sheet logger
  // try {
  //   const res = await fetch(ORDER_FALLBACK_URL, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ order: JSON.stringify(payload) }),
  //   });
  //   if (!res.ok) throw new Error("FALLBACK_SAVE_FAILED_" + res.status);
  //   return true;
  // } catch (err) {
  //   console.error("Order fallback save failed", err);
  //   return false;
  // }
}

async function placeFinalOrder() {
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
  const expectedInfo = computeExpectedDelivery();
  const locationPayload = capturedLocation
    ? {
        ...capturedLocation,
        distanceKm: deliveryDistanceKm || null,
        mapsUrl: `https://www.google.com/maps?q=${capturedLocation.lat},${capturedLocation.lng}`,
      }
    : null;

  /* ✅ API SAVE */
  const payload = {
    orderId,
    orderDate: formatLocalDateISO(new Date()),
    orderTime: formatLocalTime(new Date()),

    orderFor: getOrderForDateISO(),

    customer: customerName,
    phone: customerPhone,
    address: customerAddress,
    notes: customerNotes,

    items: itemsText.trim(),
    extras: extrasField,

    total: finalTotal,
    expectedDelivery: expectedInfo.label,
    expectedDeliveryIso: expectedInfo.iso || "",
    couponCode: appliedCoupon || enteredCoupon || "",
    couponDiscount: discountAmount || 0,
    location: locationPayload,
    locationUrl: locationPayload?.mapsUrl || "",
    deliveryDistanceKm: locationPayload?.distanceKm || null,
  };

  await persistOrder(payload);

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
${expectedInfo?.label ? `*Expected Delivery:* ${expectedInfo.label}\n` : ""}
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
  checkSession();
  initDeliveryCharge();
  setupFilters();
  setupParallax();
  setupCartTouch();
  setupCartFocusGuards();
  setupCartOutsideTouch();
  bindSectionContextListeners();
});

async function checkSession() {
  try {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    
    if (data.authenticated) {
      customerPhone = data.mobile;
      const userRes = await fetch(`/users/${data.mobile}`);
      const userData = await userRes.json();
      
      if (userData.user) {
        currentUser = userData.user;
        customerName = currentUser.name;
        customerAddress = currentUser.address || '';
      }
    }
  } catch (err) {
    console.error('Session check failed:', err);
  }
}
window.addEventListener("scroll", handleCartScroll, { passive: true });
window.addEventListener("resize", () => {
  syncCartVisibility();
  handleSectionContextScroll();
});

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
    defaultSearchPlaceholder =
      searchInput.getAttribute("placeholder") || defaultSearchPlaceholder;
  }

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

function getSelectedOrderType() {
  const checked = document.querySelector('input[name="orderType"]:checked');
  if (checked && checked.value) {
    orderType = checked.value;
  }
  return orderType;
}

function syncOrderTypeRadios() {
  const radios = document.querySelectorAll('input[name="orderType"]');
  if (!radios.length) return;
  radios.forEach((r) => {
    r.checked = r.value === orderType;
    r.onchange = () => {
      orderType = r.value;
      updateExpectedDeliveryUI();
    };
  });
}

function computeExpectedDelivery() {
  const orderDate = new Date(window.ORDER_FOR_DATE);
  orderDate.setHours(0, 0, 0, 0);
  const today = getTodayStart();
  const tomorrow = getTomorrowStart();
  const dateLabel = orderDate.getTime() === today.getTime()
    ? "Today"
    : orderDate.getTime() === tomorrow.getTime()
      ? "Tomorrow"
      : orderDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  if (orderDay === "today") {
    const now = new Date();
    const t = now.getHours() * 60 + now.getMinutes();
    if (t < 13 * 60 + 30) {
      const eta = new Date(now);
      eta.setMinutes(eta.getMinutes() + TODAY_PREP_MINUTES);
      return { label: `${dateLabel} · ${formatTime12(eta)}`, iso: eta.toISOString() };
    }
    return { label: `${dateLabel} · Dinner · estimating…`, iso: null };
  }

  const type = getSelectedOrderType() || "Lunch";
  return { label: `${dateLabel} · ${type} · ${FUTURE_WINDOWS[type] || "Scheduled delivery"}`, iso: null };
}

async function fetchAiDeliveryEta() {
  const items = Object.values(selectedItems).map(i => ({
    name: i.name,
    qty: i.qty,
    category: Object.keys(selectedItems).find(k => selectedItems[k] === i)?.split("__")[0] || ""
  }));

  try {
    const res = await fetch("/api/delivery-eta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, orderDay })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data.label;
  } catch {
    return null;
  }
}

function updateExpectedDeliveryUI() {
  const el = document.getElementById("expected-delivery");
  if (!el) return;

  const info = computeExpectedDelivery();
  el.textContent = info.label;
  el.setAttribute("data-eta-iso", info.iso || "");

  // If placeholder, fetch AI estimate and update
  if (info.label.includes("estimating")) {
    fetchAiDeliveryEta().then(label => {
      if (label) {
        el.textContent = label;
      } else {
        el.textContent = "Dinner · 8:00 PM";
      }
    });
  }
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

function setupCartOutsideTouch() {
  document.addEventListener("touchstart", (e) => {
    if (!isMobileView() || cartMinimized || !cartHasItems) return;
    
    const cart = document.getElementById("floating-cart");
    if (!cart || cart.contains(e.target)) return;

    const otpModal = document.getElementById('otp-modal');
    if (otpModal && otpModal.classList.contains('show')) return;

    const customerModal = document.getElementById('customer-modal');
    if (customerModal && customerModal.classList.contains('show')) return;
    
    minimizeCart();
  }, { passive: true });
}

function setupCartTouch() {
  const cart = document.getElementById("floating-cart");
  if (!cart) return;

  cart.addEventListener("touchstart", handleCartTouchStart, { passive: true });
  cart.addEventListener("touchmove", handleCartTouchMove, { passive: false });
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

  if (deltaY > 10 && atTop) {
    e.preventDefault();
  }

  if (deltaY > 80 && atTop) {
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
  updateExpectedDeliveryUI();
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
  updateExpectedDeliveryUI();
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof updateSelectedLabel === "function") updateSelectedLabel();
};

window.addEventListener("focus", () => {
  refreshKitchenState();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshKitchenState();
});
