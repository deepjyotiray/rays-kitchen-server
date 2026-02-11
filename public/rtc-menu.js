/* ================= RTC MENU GLOBALS ================= */
window.ORDER_FOR_DATE = window.ORDER_FOR_DATE || new Date();

const API_URL = "https://api.healthymealspot.com/orders";
const ORDER_FALLBACK_URL = "https://script.google.com/macros/s/AKfycbzpV6819bR3ta2wkFGL7lpOcO-ZhbOZXUimcvR8XMSRHsAaq1zF7zMinjd82ukbq7ml/exec";

let freeDeliveryTarget = Number(window.FREE_DELIVERY_TARGET) || 1500;
let baseFreeDeliveryTarget = freeDeliveryTarget;

let menuData = {};
let vegOnly = false;
let selectedItems = {};

let customerName = "", customerPhone = "", customerAddress = "", customerNotes = "", currentUser = null;

let locationAllowed = true, capturedLocation = null, deliveryCharge = Number(window.DEFAULT_DELIVERY_CHARGE) || 0, deliveryDistanceKm = 0;

let enteredCoupon = null, appliedCoupon = null, discountAmount = 0;

let cartHasItems = false, cartMinimized = false, lastScrollY = window.scrollY, lastCartCount = 0;
let lastAddedItemId = null, cartHighlightTimer = null;
let cartTouchStartY = null, cartTouchActive = false;
let cartInteractionLocked = false, cartFocusResetTimer = null;

let coupons = {};
let searchQuery = "";

function safeItemKey(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function matchesFilters(item) {
  if (vegOnly && !item.veg) return false;
  
  const name = (item.name || "").toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const hasText = !searchQuery || name.includes(searchQuery) || desc.includes(searchQuery);
  
  return hasText;
}

/* ================= DELIVERY CHARGE ================= */
async function initDeliveryCharge() {
  locationAllowed = true;

  if (!navigator.geolocation) {
    locationAllowed = false;
    capturedLocation = null;
    deliveryCharge = Number(window.DEFAULT_DELIVERY_CHARGE) || 50;
    freeDeliveryTarget = null;
    baseFreeDeliveryTarget = freeDeliveryTarget;
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
      freeDeliveryTarget = data.freeDeliveryThreshold === null ? null : Number(data.freeDeliveryThreshold) || freeDeliveryTarget;
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

/* ================= MENU LOADING ================= */
fetch("/coupons.json?v=" + Date.now())
  .then((r) => r.json())
  .then((d) => (coupons = d || {}));

async function fetchMenuData() {
  try {
    const res = await fetch("/rtc-menu.json");
    if (!res.ok) throw new Error("MENU_LOAD_FAILED");
    const data = await res.json();
    menuData = data;
    renderMenu();
  } catch (err) {
    console.error("Failed to load RTC menu:", err);
    menuData = {};
    renderMenu();
  }
}

(async function initApp() {
  await fetchMenuData();
  await loadExistingUser();
  await initDeliveryCharge();
})();

/* ================= RENDER MENU ================= */
function renderMenu() {
  const c = document.getElementById("menu-container");
  c.innerHTML = "";

  let renderedAny = false;
  let renderIndex = 0;

  Object.entries(menuData).forEach(([k, s], idx) => {
    const filteredItems = (s.items || []).filter((itm) => matchesFilters(itm));

    if (searchQuery && filteredItems.length === 0) {
      return;
    }

    const sec = document.createElement("section");
    sec.className = "section card-appear";
    sec.id = `section-${safeItemKey(k)}`;
    sec.style.animationDelay = `${renderIndex * 60}ms`;

    sec.innerHTML = `
      <div class="section-header">
        <h2>${s.title}</h2>
      </div>
      ${s.subheading ? `<div class="menu-subheading">${s.subheading}</div>` : ""}
      
      <div class="menu-grid">
        ${filteredItems.length
          ? filteredItems
              .map((i) => {
                const itemBaseId = `${k}__${i.name}`;
                const itemDomKey = safeItemKey(itemBaseId);
                
                return `
                  <div class="menu-item rtc-item" data-item-key="${itemDomKey}">
                    <div>
                      <div class="item-name">
                        <span class="food-indicator ${i.veg ? "veg" : "non-veg"}"></span>
                        ${i.name}
                      </div>
                      ${i.description ? `<div class="item-desc">${i.description}</div>` : ""}
                      
                      <div class="weight-options">
                        ${Object.entries(i.weights)
                          .map(([weight, price]) => {
                            const itemId = `${itemBaseId}__${weight}`;
                            const qty = selectedItems[itemId]?.qty || 0;
                            const inCart = qty > 0;
                            
                            return `
                              <div class="weight-option ${inCart ? 'weight-option-in-cart' : ''}">
                                <div class="weight-info">
                                  <span class="weight-label">${weight}</span>
                                  <span class="weight-price">₹${price}</span>
                                </div>
                                <div class="qty-box">
                                  <button class="qty-btn qty-minus" ${qty <= 0 ? 'disabled' : ''} onclick="updateQty('${itemId}','${i.name} (${weight})',${price},-1)" aria-label="Remove ${i.name} ${weight}">−</button>
                                  <span class="menu-qty" data-id="${itemId}">${qty}</span>
                                  <button class="qty-btn qty-plus ${qty > 0 ? 'qty-plus-active' : ''}" onclick="updateQty('${itemId}','${i.name} (${weight})',${price},1)" aria-label="Add ${i.name} ${weight}">+</button>
                                </div>
                              </div>
                            `;
                          })
                          .join("")}
                      </div>
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
    c.innerHTML = `<div class="empty-state">No items match your filters right now.</div>`;
  }
  updateCart();
}

/* ================= UPDATE QTY ================= */
function updateQty(id, name, price, delta) {
  if (!selectedItems[id])
    selectedItems[id] = { name, price, qty: 0 };

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

    if (typeof showToast === "function") {
      showToast(`${name} added to cart`);
    }

    if (navigator?.vibrate) {
      navigator.vibrate(12);
    }
  }

  if (selectedItems[id].qty <= 0) delete selectedItems[id];

  updateCart();
  updateMenuQtyUI(id);
}

function updateMenuQtyUI(itemId) {
  const span = document.querySelector(`.menu-qty[data-id="${itemId}"]`);
  const qty = selectedItems[itemId]?.qty || 0;
  if (span) span.textContent = qty;

  // Update weight option styling
  const weightOption = span?.closest('.weight-option');
  if (weightOption) {
    weightOption.classList.toggle('weight-option-in-cart', qty > 0);
  }

  // Update buttons
  const qtyBox = span?.closest('.qty-box');
  if (qtyBox) {
    const minusBtn = qtyBox.querySelector('.qty-minus');
    const plusBtn = qtyBox.querySelector('.qty-plus');
    
    if (minusBtn) minusBtn.disabled = qty <= 0;
    if (plusBtn) plusBtn.classList.toggle('qty-plus-active', qty > 0);
  }
}

/* ================= CART ================= */
function updateCart() {
  const c = document.getElementById("cart-items");
  const t = document.getElementById("cart-total");
  const b = document.getElementById("cart-order-btn");
  const itemCount = Object.values(selectedItems).reduce((s, i) => s + i.qty, 0);

  c.innerHTML = `<div class="cart-header-row"><span>Item</span><span>Rate</span><span>Qty</span></div>`;

  let total = 0;
  let freeEligibleSubtotal = 0;

  Object.entries(selectedItems).forEach(([itemId, i]) => {
    const highlightClass = lastAddedItemId && lastAddedItemId === itemId ? " cart-row-highlight" : "";

    total += i.qty * i.price;
    freeEligibleSubtotal += i.qty * i.price;

    c.innerHTML += `
      <div class="cart-row${highlightClass}">
        <div class="cart-item">
          <div class="cart-item-title">${i.name}</div>
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
  const eligibleSubtotalBeforeDelivery = Math.max(freeEligibleSubtotal - discountAmount, 0);

  if (deliveryCharge > 0 || !locationAllowed) {
    const deliveryWaived = locationAllowed && freeDeliveryTarget !== null && eligibleSubtotalBeforeDelivery >= freeDeliveryTarget;
    const appliedDeliveryCharge = locationAllowed ? (deliveryWaived ? 0 : deliveryCharge) : deliveryCharge || Number(window.DEFAULT_DELIVERY_CHARGE) || 50;

    const deliveryLabel = locationAllowed ? `₹${appliedDeliveryCharge}` : `Est. ₹${appliedDeliveryCharge} (final fee later)`;

    c.innerHTML += `
      <div class="cart-row">
        <span class="delivery-label">🚚 Delivery:</span>
        <span class="cart-rate">${deliveryLabel}</span>
      </div>`;
  }

  const deliveryWaived = locationAllowed && freeDeliveryTarget !== null && eligibleSubtotalBeforeDelivery >= freeDeliveryTarget;
  const appliedDeliveryCharge = locationAllowed ? (deliveryWaived ? 0 : deliveryCharge) : deliveryCharge;
  updateCartProgress(eligibleSubtotalBeforeDelivery, deliveryWaived);

  const finalTotal = Math.max(subtotalBeforeDelivery + appliedDeliveryCharge, 0);
  t.textContent = `₹${finalTotal}`;

  b.disabled = finalTotal === 0;
  updateCartSummary(finalTotal, itemCount);
  syncCartVisibility();
}

/* ================= COUPONS ================= */
window.applyCoupon = function () {
  const code = document.getElementById("coupon-input").value.trim().toUpperCase();
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

/* ================= USER MANAGEMENT ================= */
window.loginUser = async function() {
  const mobile = document.getElementById("reg-mobile").value.trim();
  
  if (!mobile) {
    alert("Please enter your mobile number");
    return;
  }
  
  try {
    const res = await fetch(`/users/${mobile}`);
    
    if (!res.ok) {
      if (res.status === 404) {
        alert("No account found with this mobile number. Please register first.");
        return;
      }
      throw new Error("Login failed");
    }
    
    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;
    customerPhone = currentUser.mobile;
    customerAddress = currentUser.address || "";
    
    localStorage.setItem("user_mobile", mobile);
    
    showOrderStep();
    
    if (typeof showToast === "function") {
      showToast(`Welcome back, ${currentUser.name}!`);
    }
  } catch (e) {
    console.error("Login error:", e);
    alert("Login failed. Please try again.");
  }
};

window.registerUser = async function() {
  const name = document.getElementById("reg-name").value.trim();
  const mobile = document.getElementById("reg-mobile").value.trim();
  
  if (!name || !mobile) {
    alert("Please enter both name and mobile number");
    return;
  }
  
  try {
    const res = await fetch("/users/register", {
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
    
    showOrderStep();
    
    if (typeof showToast === "function") {
      showToast(data.updated ? "Welcome back!" : "Registration successful!");
    }
  } catch (e) {
    console.error("Registration error:", e);
    alert("Registration failed. Please try again.");
  }
};

window.editUser = function() {
  showRegistrationStep();
  if (currentUser) {
    document.getElementById("reg-name").value = currentUser.name;
    document.getElementById("reg-mobile").value = currentUser.mobile;
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
    const res = await fetch(`/users/${currentUser.mobile}/orders`);
    
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
    
    // Show orders in a simple alert for now
    const ordersList = orders.map(order => 
      `Order ${order.id}: ₹${order.total} (${new Date(order.order_date).toLocaleDateString()})`
    ).join('\n');
    
    alert(`Your Recent Orders:\n\n${ordersList}`);
    
  } catch (e) {
    console.error("Error fetching orders:", e);
    if (typeof showToast === "function") {
      showToast("Failed to load orders. Please try again.");
    }
  }
};

function showRegistrationStep() {
  document.getElementById("registration-step").style.display = "block";
  document.getElementById("order-step").style.display = "none";
}

function showOrderStep() {
  document.getElementById("registration-step").style.display = "none";
  document.getElementById("order-step").style.display = "block";
  
  const userDisplay = document.getElementById("user-display");
  if (userDisplay && currentUser) {
    userDisplay.textContent = `${currentUser.name} (${currentUser.mobile})`;
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
    const res = await fetch(`/users/${savedMobile}`);
    if (!res.ok) return;
    
    const data = await res.json();
    currentUser = data.user;
    customerName = currentUser.name;
    customerPhone = currentUser.mobile;
    customerAddress = currentUser.address || "";
  } catch (e) {
    console.warn("Failed to load existing user:", e);
  }
}

/* ================= ORDERING ================= */
window.orderOnWhatsApp = function () {
  if (!Object.keys(selectedItems).length) return;
  
  if (currentUser) {
    showOrderStep();
  } else {
    showRegistrationStep();
  }
  
  document.getElementById("customer-modal").classList.add("show");
};

window.closeCustomerModal = () =>
  document.getElementById("customer-modal").classList.remove("show");

window.confirmOrder = function () {
  customerAddress = document.getElementById("cust-address").value.trim();
  customerNotes = document.getElementById("cust-notes").value.trim();

  if (!customerAddress) {
    alert("Please enter delivery address");
    return;
  }

  if (currentUser && customerAddress !== currentUser.address) {
    updateUserAddress(customerAddress);
  }

  closeCustomerModal();

  const waWindow = window.open("", "_blank");
  setTimeout(() => placeFinalOrder(waWindow), 50);
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

  try {
    const res = await fetch(ORDER_FALLBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: JSON.stringify(payload) }),
    });
    if (!res.ok) throw new Error("FALLBACK_SAVE_FAILED_" + res.status);
    return true;
  } catch (err) {
    console.error("Order fallback save failed", err);
    return false;
  }
}

async function placeFinalOrder(waWindow) {
  let subtotal = 0;
  let itemsText = "";
  const eligibleSubtotal = Math.max(Object.values(selectedItems).reduce((s, i) => s + (i.qty * i.price), 0) - discountAmount, 0);
  const deliveryWaived = locationAllowed && freeDeliveryTarget !== null && eligibleSubtotal >= freeDeliveryTarget;
  const appliedDeliveryCharge = locationAllowed ? (deliveryWaived ? 0 : deliveryCharge) : deliveryCharge;

  Object.entries(selectedItems).forEach(([id, item]) => {
    const lineTotal = item.price * item.qty;
    subtotal += lineTotal;
    itemsText += `• ${item.name} x ${item.qty} = ₹${lineTotal}\n`;
  });

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
  const orderId = "RTC-" + Date.now();
  const locationPayload = capturedLocation ? {
    ...capturedLocation,
    distanceKm: deliveryDistanceKm || null,
    mapsUrl: `https://www.google.com/maps?q=${capturedLocation.lat},${capturedLocation.lng}`,
  } : null;

  const payload = {
    orderId,
    orderDate: new Date().toISOString().split('T')[0],
    orderTime: new Date().toTimeString().split(' ')[0],
    orderFor: "Ready to Cook Items",
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
  };

  await persistOrder(payload);

  const message = `🧾 *New RTC Order ${orderId}*\n*Ready to Cook Items*\n\n*Name:* ${customerName}\n*Phone:* ${customerPhone}\n*Address:* ${customerAddress}${locationPayload?.mapsUrl ? `\nLocation: ${locationPayload.mapsUrl}` : ""}\n\n*Items Ordered:*\n${itemsText}\n\n${extrasField ? `*Extras:*\n${extrasField}\n` : ""}\n----------------------\nTotal: ₹${finalTotal}`;

  waWindow.location.href = "https://wa.me/919326492088?text=" + encodeURIComponent(message);

  selectedItems = {};
  updateCart();
  renderMenu();

  setTimeout(() => {
    window.location.href = "/thank-you.html?orderId=" + encodeURIComponent(orderId);
  }, 300);
}

/* ================= CART VISIBILITY & INTERACTION ================= */
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

  const currentTotal = Number((document.getElementById("cart-total")?.textContent || "").replace(/[^\d.]/g, "")) || 0;
  updateCartSummary(currentTotal, count);
}

function minimizeCart() {
  if (!cartHasItems) return;
  cartMinimized = true;
  syncCartVisibility();
}

function expandCart() {
  if (!cartHasItems) return;
  cartMinimized = false;
  syncCartVisibility();
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
    msg.textContent = locationAllowed ? "Delivery charges apply based on distance" : "Delivery charges shared at confirmation";
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
  summary.textContent = `🛒 ${count} item${count === 1 ? "" : "s"} · ₹${total}`;
  summary.onclick = expandCart;
}

/* ================= FILTERS ================= */
function setupFilters() {
  const searchInput = document.getElementById("search-dishes");
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

  if (vegBtn) {
    vegBtn.addEventListener("click", () => {
      vegOnly = !vegOnly;
      vegBtn.setAttribute("aria-pressed", vegOnly.toString());
      vegBtn.classList.toggle("active", vegOnly);
      renderMenu();
    });
  }
}

/* ================= TOAST ================= */
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = msg;
  toast.classList.add("show");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
}

/* ================= INITIALIZATION ================= */
document.addEventListener("DOMContentLoaded", () => {
  setupFilters();
  syncCartVisibility();
});

window.addEventListener("resize", () => {
  syncCartVisibility();
});