let menuData = {};
let vegOnly = false;
let selectedItems = {};
let orderDay = "today";
let orderType = new Date().getHours() < 16 ? "Lunch" : "Dinner";

let customerName = "";
let customerPhone = "";
let customerAddress = "";
let locationAllowed = true;
let deliveryCharge = 0;
let deliveryDistanceKm = 0;

let enteredCoupon = null;

/* ================= DELIVERY (AUTO ON LOAD) ================= */

async function initDeliveryCharge() {
  locationAllowed = true;

  if (!navigator.geolocation) {
    locationAllowed = false;
    updateCart();
    showLocationBlockedBanner();
    return;
  }

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });

    const payload = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    };

    const res = await fetch("/api/delivery-charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("DELIVERY_API_FAILED");

    const data = await res.json();

    deliveryCharge = Number(data.deliveryCharge) || 0;
    deliveryDistanceKm = Number(data.distanceKm) || 0;
  } catch (e) {
    console.warn("❌ Location denied or failed:", e);
    locationAllowed = false;
    deliveryCharge = 0;
    deliveryDistanceKm = 0;
    showLocationBlockedBanner();
  }

  updateCart();
}

/* ================= COUPONS ================= */

let coupons = {};
let appliedCoupon = null;
let discountAmount = 0;

fetch("/coupons.json?v=" + Date.now())
  .then(r => r.json())
  .then(data => {
    coupons = data || {};
  })
  .catch(() => console.warn("Coupons not loaded"));

/* ---------- PAGE CONTEXT ---------- */
const isCorporatePage = window.location.pathname.toLowerCase().includes("corporate");

/* ---------- TIME HELPERS ---------- */
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function isSectionAvailable(key) {
  if (orderDay === "tomorrow") return true;

  const t = nowMinutes();
  if (t < 7 * 60) return false;
  if (key === "breakfast") return t < 9 * 60;
  if (key.includes("starter")) return t < 24 * 60;
  if (key.includes("main")) return t < 24 * 60;
  if (key.includes("rice")) return t < 24 * 60;
  if (key.includes("sweet")) return t < 24 * 60;
  return true;
}

/* ---------- LOAD MENU ---------- */
const MENU_FILE = isCorporatePage ? "corporate_menu.json" : "menu.json";

fetch(MENU_FILE)
  .then(r => r.json())
  .then(data => {
    menuData = data;
    renderMenu();
  })
  .catch(err => {
    console.error("Failed to load menu:", err);
    alert("Unable to load menu. Please refresh.");
  });

/* ---------- RENDER MENU ---------- */
function renderMenu() {
  cleanupUnavailableSelections();

  const c = document.getElementById("menu-container");
  c.innerHTML = "";

  Object.entries(menuData).forEach(([k, s]) => {
    if (vegOnly && !s.veg) return;

    const available = isSectionAvailable(k);
    const sec = document.createElement("section");
    sec.className = "section";

    const isMainCourse = k === "veg_main" || k === "non_veg_main";

    sec.innerHTML = `
      <h2>${s.title}</h2>
      <div class="menu-grid">
        ${s.items.map(i => `
          <div class="menu-item ${!available ? "disabled" : ""}">
            <div>
              <div class="item-name">
                <span class="food-indicator ${i.veg ? "veg" : "non-veg"}"></span>
                ${i.name}
              </div>
              <div class="item-price">
              ${k === "SeaFood_starters" ? "Market Price" : `Rs. ${i.price}`}
              </div>

            </div>
            <div class="qty-box">
              <button ${!available ? "disabled" : ""} onclick="updateQty('${k}__${i.name}','${i.name}',${i.price},-1)">−</button>
              <span class="menu-qty" data-id="${k}__${i.name}">
              ${selectedItems[`${k}__${i.name}`]?.qty || 0}
              </span>
              <button ${!available ? "disabled" : ""} onclick="updateQty('${k}__${i.name}','${i.name}',${i.price},1)">+</button>
            </div>
          </div>
        `).join("")}
      </div>
      ${isMainCourse ? `<p class="main-course-note">
        Choose either <strong>3 Chapati</strong> or <strong>Rice bowl</strong>
      </p>` : ""}
    `;

    c.appendChild(sec);
  });

  updateCart();
}

/* ---------- UPDATE QTY ---------- */
function updateQty(id, name, price, delta) {
  if (!selectedItems[id]) {
    selectedItems[id] = { name, price, qty: 0 };
  }

  selectedItems[id].qty += delta;

  if (selectedItems[id].qty <= 0) {
    delete selectedItems[id];
  }

  updateCart();   // ✅ only update cart
  updateMenuQtyUI(id); // optional (see below)
}

function updateMenuQtyUI(itemId) {
  const span = document.querySelector(`.menu-qty[data-id="${itemId}"]`);
  if (!span) return;

  span.textContent = selectedItems[itemId]?.qty || 0;
}


/* ---------- CLEANUP ---------- */
function cleanupUnavailableSelections() {
  Object.keys(selectedItems).forEach(id => {
    const sectionKey = id.split("__")[0];
    if (!isSectionAvailable(sectionKey)) delete selectedItems[id];
  });
}

/* ================= COUPON APPLY ================= */

window.applyCoupon = function () {
  const code = document.getElementById("coupon-input").value.trim().toUpperCase();
  const msg = document.getElementById("coupon-msg");

  msg.textContent = "";
  msg.className = "coupon-msg";

  enteredCoupon = code;

  if (!code || !coupons[code] || !coupons[code].active) {
    appliedCoupon = null;
    discountAmount = 0;
    msg.textContent = "❌ Invalid coupon code";
    msg.classList.add("error");
    updateCart();
    return;
  }

  validateCoupon(getCartSubtotal());
  updateCart(); // force UI refresh

};

function validateCoupon(subtotal) {
  const msg = document.getElementById("coupon-msg");

  discountAmount = 0;
  // appliedCoupon = null;

  if (!enteredCoupon || !coupons[enteredCoupon]) return;

  const rule = coupons[enteredCoupon];

  if (subtotal < rule.minOrder) {
    msg.textContent = `⚠️ Add ₹${rule.minOrder - subtotal} more to use ${enteredCoupon}`;
    msg.className = "coupon-msg error";
    return;
  }

  appliedCoupon = enteredCoupon;
  discountAmount = rule.discount;

  msg.textContent = `✅ Coupon applied! You saved ₹${discountAmount}`;
  msg.className = "coupon-msg success";
}


function getCartSubtotal() {
  let total = 0;
  Object.values(selectedItems).forEach(i => {
    total += i.qty * i.price;
  });
  return total;
}

/* ---------- CART ---------- */
function updateCart() {
  const c = document.getElementById("cart-items");
  const t = document.getElementById("cart-total");
  const b = document.getElementById("cart-order-btn");
  const cart = document.getElementById("floating-cart");

  // Reset cart UI
  c.innerHTML = `
    <div class="cart-header-row">
      <span>Item</span>
      <span>Rate</span>
      <span>Qty</span>
    </div>
  `;

  let total = 0;

  // Build cart rows + subtotal
  Object.entries(selectedItems).forEach(([itemId, i]) => {
    const lineTotal = i.qty * i.price;
    total += lineTotal;

    c.innerHTML += `
      <div class="cart-row">
        <span class="cart-item-name">${i.name}</span>
        <span class="cart-rate">
        ${itemId.startsWith("SeaFood_starters__") ? "Market Price" : `₹${i.price}`}
        </span>

        <span class="cart-qty">
          <button onclick="updateQty('${itemId}','${i.name}',${i.price},-1)">−</button>
          <span>${i.qty}</span>
          <button onclick="updateQty('${itemId}','${i.name}',${i.price},1)">+</button>
        </span>
      </div>
    `;
  });

  /* ✅ IMPORTANT: validate coupon AFTER subtotal calculation */
  validateCoupon(total);

  if (discountAmount < 0) discountAmount = 0;

  // Coupon row
  if (discountAmount > 0 && appliedCoupon) {
    c.innerHTML += `
      <div class="cart-row">
        <span class="cart-item-name">Coupon (${appliedCoupon})</span>
        <span class="cart-rate">−₹${discountAmount}</span>
        <span></span>
      </div>
    `;
  }

  // Delivery row
  // Delivery row
if (!locationAllowed) {
  c.innerHTML += `
    <div class="cart-row">
      <span class="cart-item-name delivery-label">
        🚚 Delivery & Packing :
      </span>
      <span class="cart-rate">
        As per actuals
      </span>
    </div>
  `;
  } else if (deliveryCharge > 0) {
  c.innerHTML += `
    <div class="cart-row">
      <span class="cart-item-name delivery-label">
        🚚 Delivery & Packing :
      </span>
      <span class="cart-rate">
        + ₹${deliveryCharge}
      </span>
    </div>
  `;
  }

  // Final total
  const finalTotal = Math.max(total - discountAmount + deliveryCharge, 0);
  t.textContent = `₹${finalTotal}`;

  // Button state
  b.disabled = finalTotal === 0;

  // Floating cart visibility
  cart.classList.toggle("cart-visible", finalTotal > 0);
  cart.classList.toggle("cart-hidden", finalTotal === 0);
}


/* ---------- ORDER FLOW ---------- */
window.orderOnWhatsApp = function () {
  if (!Object.keys(selectedItems).length) return;
  syncOrderTypeUI();
  document.getElementById("customer-modal").classList.add("show");
};

window.closeCustomerModal = function () {
  document.getElementById("customer-modal").classList.remove("show");
};

window.confirmOrder = function () {
  customerName = document.getElementById("cust-name").value.trim();
  customerPhone = document.getElementById("cust-phone").value.trim();
  customerAddress = document.getElementById("cust-address").value.trim();

  if (!customerName || !customerAddress) {
    alert("Please enter Name and Address");
    return;
  }

  const orderTypeInput = document.querySelector('input[name="orderType"]:checked');
  orderType = orderTypeInput ? orderTypeInput.value : "Lunch";

  closeCustomerModal();

  const waWindow = window.open("", "_blank");
  setTimeout(() => placeFinalOrder(waWindow), 50);
};

async function placeFinalOrder(waWindow) {
  let subtotal = 0;
  let itemsText = "";
  if (!selectedItems || !Object.keys(selectedItems).length) {
  alert("No items selected");
  return;
}


  Object.entries(selectedItems).forEach(([itemId, item]) => {
  if (itemId.startsWith("SeaFood_starters__")) {
    itemsText += `• ${item.name} x ${item.qty} = Market Price\n`;
  } else {
    const lineTotal = item.price * item.qty;
    subtotal += lineTotal;
    itemsText += `• ${item.name} x ${item.qty} = ₹${lineTotal}\n`;
  }
});


  const finalTotal = Math.max(subtotal - discountAmount + deliveryCharge, 0);
  const orderId = "RAY-" + Date.now();
  
  
let extrasLines = [];

if (!locationAllowed) {
  extrasLines.push(`+ Delivery & Packing: As per actuals`);
}
if (deliveryCharge > 0) {
  extrasLines.push(`+ Delivery Charges: ₹${deliveryCharge}`);
}

if (appliedCoupon && discountAmount > 0) {
  extrasLines.push(`- Coupon ${appliedCoupon}: ₹${discountAmount}`);
}

const extrasText = extrasLines.join("\n");


  try {
    const orderPayload = {
      orderId,
      orderDate: new Date().toLocaleDateString("en-IN"),
      orderTime: new Date().toLocaleTimeString("en-IN"),
      orderFor: isCorporatePage ? "Corporate" : "Home",
      customer: customerName,
      phone: customerPhone,
      address: customerAddress,
      items: itemsText.trim(),
      extras: extrasText,
      total: finalTotal
    };

    const payload = new FormData();
    payload.append("order", JSON.stringify(orderPayload));

    const SHEETS_URL =
      "https://script.google.com/macros/s/AKfycbzpV6819bR3ta2wkFGL7lpOcO-ZhbOZXUimcvR8XMSRHsAaq1zF7zMinjd82ukbq7ml/exec";

    navigator.sendBeacon
      ? navigator.sendBeacon(SHEETS_URL, payload)
      : fetch(SHEETS_URL, { method: "POST", body: payload, keepalive: true });
  } catch (e) {
    console.warn("Sheet logging failed", e);
  }

  const message = `🧾 *New Order*
  Order ID: ${orderId}
  *Order Type:* ${orderType}
  Name: ${customerName}
  Contact: ${customerPhone}
  Delivery Address: ${customerAddress}
  *Order Items*
  ${itemsText}
  ----------------------
  Subtotal: ₹${subtotal}
  ${extrasText ? extrasText + `\n----------------------\n` : ""}
  ${!locationAllowed 
  ? `Food Total (Excl. Delivery): ₹${finalTotal}`
  : `Total Payable: ₹${finalTotal}`
  }

  Thank you!
  `;

  const whatsappURL =
    "https://wa.me/918850545924?text=" + encodeURIComponent(message);
  waWindow ? (waWindow.location.href = whatsappURL) : window.open(whatsappURL, "_blank");
  const snapshotItems = { ...selectedItems }; // optional safety
  clearCartCompletely();
}

/* ---------- BULK ---------- */
window.bulkOrder = function () {
  window.open(
    "https://wa.me/918850545924?text=" +
      encodeURIComponent("Hello, I would like to place a bulk / catering order."),
    "_blank"
  );
};

/* ---------- VEG TOGGLE ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initDeliveryCharge();
  const vegToggle = document.getElementById("vegToggle");
  const vegText = document.getElementById("vegToggleText");

  vegToggle.addEventListener("change", () => {
    vegOnly = vegToggle.checked;
    vegText.textContent = vegOnly ? "Veg Mode ON" : "Veg Mode OFF";
    vegText.classList.toggle("on", vegOnly);
    vegText.classList.toggle("off", !vegOnly);
    renderMenu();
  });
});

/* ---------- DAY TOGGLE ---------- */
window.setOrderDay = function (day, event) {
  orderDay = day;
  document.querySelectorAll(".day-btn").forEach(b => b.classList.remove("active"));
  event.target.classList.add("active");
  renderMenu();
};

function syncOrderTypeUI() {
  const radio = document.querySelector(`input[name="orderType"][value="${orderType}"]`);
  if (radio) radio.checked = true;
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
    document.querySelector(".header").insertAdjacentElement("afterend", banner);
  }
}
function clearCartCompletely() {
  selectedItems = {};
  appliedCoupon = null;
  enteredCoupon = null;
  discountAmount = 0;

  deliveryCharge = locationAllowed ? deliveryCharge : 0;

  document.getElementById("coupon-input").value = "";
  document.getElementById("coupon-msg").textContent = "";

  renderMenu();   // resets menu counters
  updateCart();   // resets cart UI
}
