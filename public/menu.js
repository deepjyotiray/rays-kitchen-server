/* ================= CATEGORY TAB ICONS ================= */
const SECTION_ICONS = {
  healthy: '🥗',
  healthySubs: '📦',
  breakfast: '🍳',
  veg_starters: '🥙',
  veg_main: '🍛',
  non_veg_starters: '🍗',
  SeaFood_starters: '🦐',
  non_veg_main: '🍖',
  'rice&breads': '🍚',
  sweets: '🍮',
};

/* ================= ITEM IMAGES ================= */
// Loaded from DB-backed API at runtime; populated on init
let ITEM_IMAGES = {};
fetch('/api/item-images').then(r => r.ok ? r.json() : {}).then(d => { ITEM_IMAGES = d; }).catch(() => {});


function getItemImage(name) {
  return ITEM_IMAGES[name] || null;
}

function getSectionIcon(key) {
  return SECTION_ICONS[key] || '🍽️';
}

/* ================= RENDER CATEGORY TABS ================= */
function renderCategoryTabs() {
  const tabsEl = document.getElementById('category-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  Object.entries(menuData).forEach(([k, s]) => {
    if (s.available === false) return;
    const btn = document.createElement('button');
    btn.className = 'category-tab';
    btn.dataset.key = k;
    btn.innerHTML = `<span class="tab-icon">${getSectionIcon(k)}</span><span>${s.title}</span>`;
    btn.addEventListener('click', () => scrollToSection(k));
    tabsEl.appendChild(btn);
  });
  updateActiveTab();
}

function scrollToSection(key) {
  const sec = document.getElementById('section-' + safeItemKey(key));
  if (!sec) return;
  // Expand if collapsed
  const grid = document.getElementById('grid-' + key);
  const chev = document.getElementById('chev-' + key);
  if (grid && grid.classList.contains('collapsed')) {
    grid.classList.remove('collapsed');
    if (chev) chev.textContent = '▾';
  }
  const offset = 64 + 88; // appbar + sticky controls
  const top = sec.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}

function updateActiveTab() {
  const tabs = document.querySelectorAll('.category-tab');
  if (!tabs.length) return;
  const sections = Array.from(document.querySelectorAll('#menu-container section'));
  if (!sections.length) return;
  const offset = 64 + 88 + 20;
  let activeKey = null;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].getBoundingClientRect().top <= offset) {
      activeKey = sections[i].id.replace('section-', '');
      break;
    }
  }
  if (!activeKey && sections.length) {
    activeKey = sections[0].id.replace('section-', '');
  }
  tabs.forEach(t => {
    const match = safeItemKey(t.dataset.key) === activeKey;
    t.classList.toggle('active', match);
    if (match) {
      t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

window.addEventListener('scroll', updateActiveTab, { passive: true });

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
  customerNotes = "";
var currentUser = null;

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

function syncOrderDayFromDate() {
  const selected = getStartOfDay(window.ORDER_FOR_DATE || new Date());
  const today = getStartOfDay(new Date());
  orderDay = selected > today ? "tomorrow" : "today";
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

function showLocationBlockedBanner() {}

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
  if (available) return "";
  return "Kitchen is currently closed";
}

function isSectionAvailable(key) {
  return !kitchenClosedToday();
}

const isCorporatePage = window.location.pathname
  .toLowerCase()
  .includes("corporate");

const MENU_FILE = isCorporatePage ? "corporate_menu.json" : "menu.json";

async function refreshKitchenState() {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("STATE_LOAD_FAILED");
    const data = await res.json();
    window.KITCHEN_CLOSED_TODAY = !!data.kitchenClosedToday;
    kitchenClosures = Array.isArray(data.closures) ? data.closures : [];
    window.KITCHEN_CLOSURES = kitchenClosures;
    syncOrderDayFromDate();
    updateEtaLabel();
    syncCartVisibility();
    if (typeof renderCalendar === "function") renderCalendar();
    if (typeof updateSelectedLabel === "function") updateSelectedLabel();
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
  window.ORDER_FOR_DATE = getTodayStart();
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

  const c = document.getElementById("menu-container");
  c.innerHTML = "";

  const kitchenClosed = kitchenClosedToday();
  if (kitchenClosed) {
    const notice = document.createElement("div");
    notice.className = "kitchen-closed-notice";
    notice.textContent = "🚫 Kitchen closed";
    c.appendChild(notice);
  }

  let renderedAny = false;
  let renderIndex = 0;

  Object.entries(menuData).forEach(([k, s], idx) => {
    // Skip unavailable sections
    if (s.available === false) return;
    
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
          ${collapsed ? "▾" : "▾"}
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
            const plusDisabledAttr = !available || kitchenClosed ? "disabled" : "";
            const minusDisabledAttr = !available || kitchenClosed ? "disabled" : "";
            const plusActiveClass =
              qty > 0 && available ? " qty-plus-active" : "";

            const imgSrc = getItemImage(i.name);
            const imgHtml = imgSrc
              ? `<div class="item-img-wrap"><img src="${imgSrc}" alt="${i.name}" loading="lazy"></div>`
              : `<div class="item-img-wrap"><div class="item-img-placeholder">${getSectionIcon(k)}</div></div>`;

            return `
              <div class="menu-item ${!available ? "disabled" : ""} ${kitchenClosed ? "kitchen-closed" : ""} ${
              inCart ? "menu-item-in-cart" : ""
            }" data-item-key="${itemDomKey}" ${i.calories ? `data-calories="${i.calories}" data-protein="${i.protein || 0}" data-carbs="${i.carbs || 0}" data-fat="${i.fat || 0}"` : ''}>
                ${imgHtml}
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
                        <span class="qty-minus" data-item-id="${itemDomKey}" ${minusDisabledAttr ? 'style="pointer-events:none;opacity:0.4"' : ''}>\u2212</span>
                        <span class="qty-count">${qty}</span>
                        <span class="qty-plus" data-item-id="${itemDomKey}" ${plusDisabledAttr ? 'style="pointer-events:none;opacity:0.4"' : ''}>+</span>
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
  renderCategoryTabs();
  // Sync mobile menu pane whenever menu re-renders
  const _ip = document.getElementById('mobile-menu-items');
  if (_ip) {
    _ip.innerHTML = c.innerHTML;
    _ip.querySelectorAll('.scroll-reveal').forEach(el => { el.classList.remove('scroll-reveal'); el.classList.add('revealed'); });
    if (typeof bindMenuItemEvents === 'function') bindMenuItemEvents(_ip);
  }
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
      if (btn.disabled || kitchenClosedToday()) return;
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
      if (kitchenClosedToday()) return;
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
      showToast('Item added to cart !');
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

  if (selectedItems[id].qty <= 0) {
    if (delta < 0 && typeof showToast === "function") showToast('Item deleted from cart !');
    delete selectedItems[id];
  }

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
    const closed = kitchenClosedToday();
    
    // Get item details from menu data
    const [sectionKey, ...nameParts] = itemId.split('__');
    const itemName = nameParts.join('__');
    const section = menuData[sectionKey];
    const menuItem = section?.items?.find(item => item.name === itemName);
    const itemName2 = menuItem?.name || '';
    const itemPrice = menuItem?.price || 0;
    
    qtyBox.innerHTML = "";
    if (qty === 0) {
      const btn = document.createElement("button");
      btn.className = "add-btn";
      btn.dataset.available = available;
      btn.dataset.itemId = domKey;
      if (!available || closed) btn.disabled = true;
      btn.setAttribute("aria-label", "Add item");
      btn.innerHTML = '<span class="add-text">ADD</span><span class="add-plus">+</span>';
      qtyBox.appendChild(btn);
    } else {
      const ctrl = document.createElement("div");
      ctrl.className = "qty-control";
      ctrl.dataset.available = available;
      const minus = document.createElement("span");
      minus.className = "qty-minus";
      minus.dataset.itemId = domKey;
      minus.textContent = "\u2212";
      if (closed) minus.style.cssText = "pointer-events:none;opacity:0.4";
      const count = document.createElement("span");
      count.className = "qty-count";
      count.textContent = qty;
      const plus = document.createElement("span");
      plus.className = "qty-plus";
      plus.dataset.itemId = domKey;
      plus.textContent = "+";
      if (closed) plus.style.cssText = "pointer-events:none;opacity:0.4";
      ctrl.append(minus, count, plus);
      qtyBox.appendChild(ctrl);
    }
  }

  // Also update all matching panes (mobile-menu-items, etc.)
  document.querySelectorAll(`.menu-item[data-item-key="${domKey}"] .qty-box`).forEach(box => {
    if (box === qtyBox) return;
    box.innerHTML = qtyBox ? qtyBox.innerHTML : '';
    const parentItem = box.closest('.menu-item');
    if (parentItem) parentItem.classList.toggle('menu-item-in-cart', qty > 0);
  });

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
  if (kitchenClosedToday()) { selectedItems = {}; return; }
  Object.keys(selectedItems).forEach((id) => {
    const sectionKey = id.split("__")[0];
    const section = menuData[sectionKey];
    const item = (section?.items || []).find((i) => `${sectionKey}__${i.name}` === id);
    if (!id.startsWith("motd__") && item && item.available === false) {
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

  if (kitchenClosedToday()) {
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
function confettiCoupon() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const pieces = Array.from({length: 80}, () => ({
    x: Math.random() * canvas.width, y: Math.random() * -canvas.height * 0.5,
    r: Math.random() * 6 + 4, d: Math.random() * 3 + 1,
    color: ['#e53935','#43a047','#1e88e5','#fb8c00','#8e24aa','#fdd835'][Math.floor(Math.random()*6)],
    tilt: Math.random() * 10 - 5, tiltSpeed: Math.random() * 0.1 + 0.05
  }));
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.beginPath(); ctx.fillStyle = p.color;
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.4, p.tilt, 0, Math.PI * 2);
      ctx.fill();
      p.y += p.d + 1; p.x += Math.sin(frame * 0.02 + p.tilt) * 1.2;
      p.tilt += p.tiltSpeed;
    });
    frame++;
    if (frame < 120) requestAnimationFrame(draw); else canvas.remove();
  }
  draw();
}

function setCouponBtnState(applied) {
  ['coupon-apply-btn','mob-coupon-apply-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (applied) {
      btn.textContent = '✕'; btn.title = 'Remove coupon';
      btn.onclick = removeCoupon;
      btn.style.background = '#e53935';
    } else {
      btn.textContent = 'Apply'; btn.title = '';
      btn.onclick = id === 'mob-coupon-apply-btn' ? applyMobCoupon : applyCoupon;
      btn.style.background = '';
    }
  });
}

window.removeCoupon = function () {
  enteredCoupon = null; appliedCoupon = null; discountAmount = 0;
  ['coupon-input','mob-coupon-input'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['coupon-msg','mob-coupon-msg','sidebar-coupon-msg'].forEach(id => { const el = document.getElementById(id); if (el) { el.textContent = ''; el.className = 'coupon-msg'; } });
  setCouponBtnState(false);
  updateCart();
};

window.applyMobCoupon = function () {
  const mobInput = document.getElementById("mob-coupon-input");
  const desktopInput = document.getElementById("coupon-input");
  if (mobInput && desktopInput) desktopInput.value = mobInput.value;
  window.applyCoupon();
  const mobMsg = document.getElementById("mob-coupon-msg");
  const desktopMsg = document.getElementById("coupon-msg");
  if (mobMsg && desktopMsg) { mobMsg.textContent = desktopMsg.textContent; mobMsg.className = desktopMsg.className; }
};

window.applyCoupon = function () {
  const mobInput = document.getElementById("mob-coupon-input");
  const desktopInput = document.getElementById("coupon-input");
  const activeInput = (mobInput && mobInput.offsetParent !== null) ? mobInput : desktopInput;
  const code = activeInput
    .value.trim()
    .toUpperCase();

  enteredCoupon = code;
  updateCart();

  if (appliedCoupon) {
    confettiCoupon();
    setCouponBtnState(true);
    if (typeof showToast === "function") showToast(`Coupon ${appliedCoupon} applied`);
  } else {
    setCouponBtnState(false);
    if (typeof showToast === "function" && enteredCoupon) showToast("Coupon added. Reach minimum order to apply.");
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
// Tracks whether the mobile being verified belongs to an existing user
let _pendingMobileIsExisting = false;

window.proceedWithMobile = async function() {
  const mobileEl = document.getElementById("reg-mobile");
  const mobile = mobileEl.value.trim().replace(/^\+91/, '');

  if (!/^[0-9]{10}$/.test(mobile)) {
    alert("Please enter a valid 10-digit mobile number");
    return;
  }

  const continueBtn = document.getElementById("reg-continue-btn");
  continueBtn.disabled = true;
  continueBtn.textContent = "Checking…";

  try {
    const res = await fetch(`/users/${encodeURIComponent('+91' + mobile)}`);
    _pendingMobileIsExisting = res.ok;

    if (!res.ok && res.status !== 404) throw new Error("Server error");

    if (!_pendingMobileIsExisting) {
      // New user — show name field before OTP
      document.getElementById("reg-name").style.display = "block";
      document.getElementById("reg-name").focus();
    }

    // Send OTP regardless
    const otpRes = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile })
    });
    const otpData = await otpRes.json();

    if (!otpData.success) {
      alert(otpData.error || 'Failed to send OTP');
      return;
    }

    // Show OTP input inline
    const otpSection = document.getElementById("reg-otp-section");
    if (otpSection) otpSection.style.display = "block";
    continueBtn.textContent = _pendingMobileIsExisting ? "Verify & Login" : "Verify & Register";
    continueBtn.onclick = verifyMobileOTP;

    showToast && showToast("OTP sent to your WhatsApp");
  } catch (e) {
    console.error("Error:", e);
    alert("Something went wrong. Please try again.");
  } finally {
    continueBtn.disabled = false;
  }
};

window.verifyMobileOTP = async function() {
  const mobile = document.getElementById("reg-mobile").value.trim().replace(/^\+91/, '');
  const otp = document.getElementById("reg-otp").value.trim();

  if (!/^[0-9]{6}$/.test(otp)) {
    alert("Enter valid 6-digit OTP");
    return;
  }

  const continueBtn = document.getElementById("reg-continue-btn");
  continueBtn.disabled = true;
  continueBtn.textContent = "Verifying…";

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, otp })
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.error || 'Invalid OTP');
      continueBtn.disabled = false;
      continueBtn.textContent = _pendingMobileIsExisting ? "Verify & Login" : "Verify & Register";
      return;
    }

    // OTP verified — session is now set server-side
    if (_pendingMobileIsExisting) {
      // Existing user: load and proceed
      await loadUserAndShowOrder(mobile);
    } else {
      // New user: register then proceed
      const name = document.getElementById("reg-name").value.trim();
      if (!name) {
        alert("Please enter your name");
        continueBtn.disabled = false;
        return;
      }
      const regRes = await fetch("/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mobile: '+91' + mobile })
      });
      if (!regRes.ok) throw new Error("Registration failed");
      const regData = await regRes.json();
      currentUser = regData.user;
      window.currentUser = currentUser;
      customerName = currentUser.name;
      customerPhone = currentUser.mobile;
      customerAddress = currentUser.address || "";
      localStorage.setItem("user_mobile", '+91' + mobile);
      showOrderStep();
      if (typeof syncTopNav === 'function') syncTopNav();
      showToast && showToast("Registration successful!");
    }
  } catch (e) {
    console.error("Error:", e);
    alert("Something went wrong. Please try again.");
    continueBtn.disabled = false;
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
    const res = await fetch("/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mobile, address: currentUser?.address || "" })
    });

    if (!res.ok) throw new Error("Update failed");

    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;
    if (typeof syncTopNav === 'function') syncTopNav();

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
    const res = await fetch(`/users/${encodeURIComponent(currentUser.mobile)}/orders`);
    
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

  const waMsg = `🎉 *Bulk / Party Order Request*\n*Name:* ${name}\n*Mobile:* +91${mobile}\n*Address:* ${address}\n*Date:* ${dates}\n*Requirements:* ${requirements || 'Not specified'}`;

  try {
    const res = await fetch('https://api.healthymealspot.com/bulk-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mobile, address, dates, requirements })
    });
    if (!res.ok) throw new Error('Failed to submit');
  } catch {
    // API unavailable — fall through to WhatsApp
  }

  closeBulkOrderModal();
  ['bulk-name','bulk-mobile','bulk-address','bulk-dates','bulk-requirements']
    .forEach(id => { document.getElementById(id).value = ''; });
  if (btn) { btn.disabled = false; btn.textContent = 'Submit Request'; }

  // Always send via WhatsApp so the request is never lost
  window.open('https://wa.me/919326492088?text=' + encodeURIComponent(waMsg), '_blank');
  if (typeof showToast === 'function') showToast('Request sent via WhatsApp!');
};

window.closeBulkOrderModal = function() {
  document.getElementById('bulk-order-modal').classList.remove('show');
  document.body.classList.remove('modal-open');
};

function showRegistrationStep() {
  document.getElementById("registration-step").style.display = "block";
  document.getElementById("order-step").style.display = "none";
  
  // Reset form to initial state
  document.getElementById("reg-name").style.display = "none";
  document.getElementById("reg-name").value = "";
  document.getElementById("reg-mobile").value = "+91";
  document.getElementById("reg-otp").value = "";
  document.getElementById("reg-otp-section").style.display = "none";
  _pendingMobileIsExisting = false;
  
  const continueBtn = document.getElementById("reg-continue-btn");
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
    const res = await fetch(`/users/${encodeURIComponent(savedMobile)}`);
    if (!res.ok) return;
    
    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;
    customerPhone = currentUser.mobile;
    customerAddress = currentUser.address || "";
    if (data.token) localStorage.setItem("user_token", data.token);
    if (typeof syncTopNav === 'function') syncTopNav();
  } catch (e) {
    console.warn("Failed to load existing user:", e);
  }
}

/* ---------- ORDERING ---------- */
window.orderOnWhatsApp = function () {
  if (!Object.keys(selectedItems).length) return;
  if (kitchenClosedToday()) {
    showToast("Kitchen is currently closed.");
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
      if (typeof syncTopNav === 'function') syncTopNav();
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
  } else if (!currentUser) {
    _showProfileStep(mobile);
  } else {
    if (typeof showToast === 'function') showToast('Welcome back, ' + (currentUser?.name || mobile) + '!');
    if (typeof syncDrawerUser === 'function') syncDrawerUser();
  }
  if (typeof syncTopNav === 'function') syncTopNav();
}

window.logout = async function() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
  currentUser = null;
  customerName = '';
  customerPhone = '';
  customerAddress = '';
  localStorage.removeItem('user_mobile');
  closeCustomerModal();
  document.getElementById('profile-modal')?.classList.remove('show');
  if (typeof syncDrawerUser === 'function') syncDrawerUser();
  if (typeof syncTopNav === 'function') syncTopNav();
  if (typeof showToast === 'function') showToast('Signed out');
};

function _showProfileStep(mobile) {
  _ensureOTPModal();
  const card = document.querySelector('#otp-modal .otp-login-card');
  card.innerHTML = `
    <div id="otp-profile-step">
      <h2 class="otp-step-heading">Complete your profile</h2>
      <p class="otp-step-sub">Just a few details to get started</p>
      <div id="otp-profile-message" class="otp-message"></div>
      <div class="otp-field" style="margin-bottom:12px">
        <input type="text" id="profile-name" placeholder="Your full name *" autocomplete="name">
      </div>
      <div class="otp-field" style="margin-bottom:12px">
        <input type="text" id="profile-address" placeholder="Delivery address *" autocomplete="street-address">
      </div>
      <button class="otp-submit-btn" id="profile-save-btn">Save &amp; Continue</button>
    </div>`;
  document.getElementById('otp-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
  document.getElementById('profile-name').focus();
  document.getElementById('profile-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('profile-name').value.trim();
    const address = document.getElementById('profile-address').value.trim();
    const msgEl = document.getElementById('otp-profile-message');
    if (!name) { msgEl.textContent = 'Please enter your name'; msgEl.style.display = 'block'; return; }
    if (!address) { msgEl.textContent = 'Please enter your delivery address'; msgEl.style.display = 'block'; return; }
    const btn = document.getElementById('profile-save-btn');
    btn.disabled = true; btn.textContent = 'Saving\u2026';
    try {
      const res = await fetch('/users/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, address })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      currentUser = data.user || { name, mobile, address };
      customerName = name;
      customerPhone = mobile;
      customerAddress = address;
      window.currentUser = currentUser;
      closeOTPModal();
      if (typeof syncTopNav === 'function') syncTopNav();
      if (typeof syncDrawerUser === 'function') syncDrawerUser();
      if (typeof initMyHealth === 'function') initMyHealth();
      if (typeof showToast === 'function') showToast('Welcome, ' + name + '!');
      if (Object.keys(selectedItems).length > 0) {
        document.getElementById('customer-modal').classList.add('show');
        document.body.classList.add('modal-open');
      }
    } catch {
      const msgEl = document.getElementById('otp-profile-message');
      if (msgEl) { msgEl.textContent = 'Could not save. Please try again.'; msgEl.style.display = 'block'; }
      btn.disabled = false; btn.textContent = 'Save & Continue';
    }
  });
}

function _ensureOTPModal() {
  if (document.getElementById('otp-modal')) return;
  const el = document.createElement('div');
  el.id = 'otp-modal';
  el.className = 'otp-modal-overlay';
  el.innerHTML = `
    <div class="otp-login-hero">
      <div class="otp-login-logo">🍱</div>
      <h1 class="otp-login-title">Healthy Meal Spot</h1>
      <p class="otp-login-sub">Fresh, home-cooked meals delivered to you</p>
    </div>
    <div class="otp-login-card">
      <div id="otp-mobile-step">
        <h2 class="otp-step-heading">Login / Sign Up</h2>
        <p class="otp-step-sub">Enter your mobile number to continue</p>
        <div id="otp-message" class="otp-message"></div>
        <div class="otp-field">
          <span class="otp-prefix">+91</span>
          <input type="tel" id="otp-mobile" placeholder="10-digit mobile" maxlength="10" inputmode="numeric" autocomplete="tel">
        </div>
        <button class="otp-submit-btn" id="otp-send-btn">Continue</button>
        <button class="otp-ghost-btn" onclick="closeOTPModal()">Cancel</button>
      </div>
      <div id="otp-verify-step" style="display:none">
        <h2 class="otp-step-heading">Verify OTP</h2>
        <p class="otp-step-sub" id="otp-verify-sub">Sent to <strong></strong> via WhatsApp</p>
        <div id="otp-verify-message" class="otp-message"></div>
        <div class="otp-boxes" id="otp-boxes">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
          <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
        </div>
        <button class="otp-submit-btn" id="otp-verify-btn">Verify</button>
        <div class="otp-resend">
          Didn't receive? <button id="otp-resend-btn" disabled>Resend</button><span id="otp-resend-timer"></span>
        </div>
        <button class="otp-ghost-btn" onclick="resetOTP()">← Change number</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  const boxesEl = document.getElementById('otp-boxes');
  boxesEl.addEventListener('input', e => {
    const boxes = [...boxesEl.querySelectorAll('input')];
    const i = boxes.indexOf(e.target);
    if (e.target.value && i < boxes.length - 1) boxes[i + 1].focus();
    if (_getOTPCode().length === 6) window.verifyOTP();
  });
  boxesEl.addEventListener('keydown', e => {
    const boxes = [...boxesEl.querySelectorAll('input')];
    const i = boxes.indexOf(e.target);
    if (e.key === 'Backspace' && !e.target.value && i > 0) boxes[i - 1].focus();
  });
  document.getElementById('otp-send-btn').addEventListener('click', window.sendOTP);
  document.getElementById('otp-verify-btn').addEventListener('click', window.verifyOTP);
  document.getElementById('otp-resend-btn').addEventListener('click', _resendOTP);
  document.getElementById('otp-mobile').addEventListener('keydown', e => { if (e.key === 'Enter') window.sendOTP(); });
}

function _getOTPCode() {
  return [...document.querySelectorAll('#otp-boxes input')].map(b => b.value).join('');
}

let _resendTick = null;
function _startResend(secs = 30) {
  const btn = document.getElementById('otp-resend-btn');
  const timer = document.getElementById('otp-resend-timer');
  if (!btn) return;
  btn.disabled = true;
  let t = secs;
  timer.textContent = ` (${t}s)`;
  clearInterval(_resendTick);
  _resendTick = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(_resendTick); btn.disabled = false; timer.textContent = ''; }
    else timer.textContent = ` (${t}s)`;
  }, 1000);
}

async function _resendOTP() {
  const mobile = document.getElementById('otp-mobile').value.trim();
  try {
    const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile }) });
    const data = await res.json();
    if (data.success) _startResend();
    else showOTPMessage(data.error || 'Failed to resend', 'error');
  } catch { showOTPMessage('Network error', 'error'); }
}

function showOTPModal() {
  window.otpCalledFrom = 'order';
  _ensureOTPModal();
  window.resetOTP();
  document.getElementById('otp-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('otp-mobile')?.focus(), 100);
}

window.closeOTPModal = function() {
  const modal = document.getElementById('otp-modal');
  if (modal) modal.classList.remove('show');
  document.body.style.overflow = '';
  clearInterval(_resendTick);
};

window.showOTPModalForChat = function() {
  showOTPModal();
};

window.sendOTP = async function() {
  const mobile = document.getElementById('otp-mobile').value.trim();
  if (!/^[0-9]{10}$/.test(mobile)) { showOTPMessage('Enter valid 10-digit mobile', 'error'); return; }

  // if (mobile === '9594614752') {
  //   showOTPMessage('Admin mode - Enter customer mobile', 'success');
  //   document.getElementById('otp-mobile-step').style.display = 'none';
  //   document.getElementById('otp-verify-step').innerHTML = `
  //     <input type="tel" id="customer-mobile" class="otp-field" placeholder="Enter customer mobile (10 digits)" maxlength="10" style="width:100%;padding:14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:1rem;font-family:var(--font);box-sizing:border-box;margin-bottom:12px">
  //     <button class="otp-submit-btn" onclick="adminPlaceOrder()">Continue</button>
  //     <button class="otp-ghost-btn" onclick="closeOTPModal()">Cancel</button>`;
  //   document.getElementById('otp-verify-step').style.display = 'block';
  //   return;
  // }

  const btn = document.getElementById('otp-send-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile }) });
    const data = await res.json();
    if (data.success) {
      const sub = document.getElementById('otp-verify-sub');
      if (sub) sub.querySelector('strong').textContent = '+91 ' + mobile;
      document.getElementById('otp-mobile-step').style.display = 'none';
      document.getElementById('otp-verify-step').style.display = 'block';
      document.querySelector('#otp-boxes input')?.focus();
      _startResend();
    } else { showOTPMessage(data.error || 'Failed to send OTP', 'error'); }
  } catch { showOTPMessage('Network error', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Continue'; }
};

window.verifyOTP = async function() {
  const mobile = document.getElementById('otp-mobile').value.trim();
  const otp = _getOTPCode();
  if (otp.length !== 6) { showOTPMessage('Enter the 6-digit OTP', 'error'); return; }

  const btn = document.getElementById('otp-verify-btn');
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const res = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile, otp }) });
    const data = await res.json();
    if (data.success) {
      const normalizedMobile = mobile.startsWith('+91') ? mobile : '+91' + mobile;
      customerPhone = normalizedMobile;
      closeOTPModal();
      window.resetOTP();
      await loadUserAndShowOrder(normalizedMobile);
      if (typeof initMyHealth === 'function') initMyHealth();
    } else { showOTPMessage(data.error || 'Invalid OTP', 'error'); }
  } catch { showOTPMessage('Network error', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Verify'; }
};

window.resetOTP = function() {
  if (!document.getElementById('otp-mobile-step')) return;
  document.getElementById('otp-mobile-step').style.display = 'block';
  document.getElementById('otp-verify-step').style.display = 'none';
  document.getElementById('otp-mobile').value = '';
  [...document.querySelectorAll('#otp-boxes input')].forEach(b => b.value = '');
  showOTPMessage('', '');
};

function resetOTPModal() {
  window.resetOTP();
}

function showOTPMessage(msg, type) {
  const div = document.getElementById('otp-message') || document.getElementById('otp-verify-message');
  if (!div) return;
  div.textContent = msg;
  div.style.background = type === 'error' ? '#fff0ee' : type === 'success' ? '#ecfdf3' : '';
  div.style.color = type === 'error' ? '#c0392b' : type === 'success' ? '#166534' : '';
  div.style.display = msg ? 'block' : 'none';
}

window.adminPlaceOrder = async function() {
  const customerMobile = document.getElementById('customer-mobile').value.trim();
  if (!/^[0-9]{10}$/.test(customerMobile)) { showOTPMessage('Enter valid customer mobile', 'error'); return; }
  customerPhone = customerMobile;
  closeOTPModal();
  await loadUserAndShowOrder(customerMobile);
};

window.showProfileModal = function() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  const nameEl = document.getElementById('profile-modal-name');
  const phoneEl = document.getElementById('profile-modal-phone');
  if (nameEl) nameEl.textContent = currentUser ? currentUser.name : '';
  if (phoneEl) phoneEl.textContent = currentUser ? ('+91 ' + (currentUser.mobile || '').replace(/^\+91/, '')) : '';
  modal.classList.add('show');
};

window.closeCustomerModal = () => {
  document.getElementById("customer-modal").classList.remove("show");
  document.body.classList.remove("modal-open");
  const menuBtn = document.querySelector('.mob-nav-btn[data-tab="menu"]');
  if (menuBtn && !menuBtn.classList.contains('active') && typeof switchTab === 'function') {
    switchTab('menu', menuBtn);
  }
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

  if (kitchenClosedToday()) {
    showToast("Kitchen is currently closed.");
    return;
  }

  if (!locationAllowed) {
    const confirmBtn = document.querySelector("#order-step .co-btn-primary");
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
    await fetch("/users/register", {
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
    await fetch("/users/register", {
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

  fetch('/api/notify-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: customerPhone, message })
  }).catch(e => console.error('Order notify failed:', e));

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
  cart.style.display = "flex";

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
  let data = {};
  try {
    const res = await fetch('/api/auth/session');
    data = await res.json();
    
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
  if (typeof syncDrawerUser === 'function') syncDrawerUser();
  if (typeof syncTopNav === 'function') syncTopNav();
  // Restore cart saved before login redirect and open checkout
  const _savedCart = sessionStorage.getItem('_pendingCart');
  if (_savedCart) {
    try {
      const parsed = JSON.parse(_savedCart);
      if (Object.keys(parsed).length) {
        Object.assign(selectedItems, parsed);
        sessionStorage.removeItem('_pendingCart');
        updateCart();
        renderMenu();
        if (data.authenticated) {
          customerPhone = data.mobile;
          // Wait for menu to render before switching tab and opening checkout
          const _openCheckout = () => {
            setTimeout(() => {
              if (typeof switchTab === 'function') {
                const savedTab = sessionStorage.getItem('_pendingTab') || 'menu';
                sessionStorage.removeItem('_pendingTab');
                const tabBtn = document.querySelector(`.mob-nav-btn[data-tab="${savedTab}"]`);
                switchTab(savedTab, tabBtn);
              }
              loadUserAndShowOrder(data.mobile);
            }, 0);
          };
          const mc = document.getElementById('menu-container');
          if (mc && mc.children.length) {
            _openCheckout();
          } else {
            const obs = new MutationObserver(() => { obs.disconnect(); _openCheckout(); });
            obs.observe(mc, { childList: true });
          }
        }
        return;
      }
    } catch {}
  }
  if (typeof window._onSessionReady === 'function') { window._onSessionReady(); window._onSessionReady = null; }
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
  if (e.target.closest("button, .qty-plus, .qty-minus")) return;

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

/* Allow calendar buttons to set day/date from index.html */
window.setOrderType = function(slot) { orderType = slot; };
window.setOrderDay = function (day) {
  orderDay = day;
  renderMenu();
  updateEtaLabel();
  syncCartVisibility();
  updateExpectedDeliveryUI();
};

window.setOrderDate = function (isoDate) {
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  window.ORDER_FOR_DATE = target;
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
