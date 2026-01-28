/* =========================================================
   MENU OF THE DAY (SESSION BASED) — CLEANED
========================================================= */

const MOTD_JSON = "/menuOfTheDay.json";
const MOTD_SESSION_KEY = "motdShown";

let motdData = null;
let motdEnabled = false;

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // Check time (using menu.js helper or inline)
  const d = new Date();
  const t = d.getHours() * 60 + d.getMinutes();
  
  // Available between 7:00 AM and 9:00 PM
  if (t < 7 * 60 || t >= 21 * 60) {
    return; // do nothing, MOTD hidden
  }

  createMotdUI();
  loadMenuOfTheDay();

  if (!sessionStorage.getItem(MOTD_SESSION_KEY)) {
    // We wait for data to load before opening, handled in loadMenuOfTheDay
    sessionStorage.setItem(MOTD_SESSION_KEY, "true");
  }
});

/* ---------- UI CREATION ---------- */
function createMotdUI() {
  const modal = document.createElement("div");
  modal.id = "motd-modal";
  modal.className = "motd-modal";
  modal.innerHTML = `
    <div class="motd-overlay"></div>
    <div class="motd-card">
      <button class="motd-close" onclick="closeMotd()">✕</button>
      <h3>Special Menu of the Day !</h3>
      <h4>Contact us for big discounts on these items.</h4>
      <div id="motd-content"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const overlay = modal.querySelector(".motd-overlay");
  if (overlay) overlay.addEventListener("click", closeMotd);
}

function openMotd() {
  const modal = document.getElementById("motd-modal");
  if (modal) modal.classList.add("show");
}

function closeMotd() {
  const modal = document.getElementById("motd-modal");
  if (modal) modal.classList.remove("show");
}

/* ---------- LOAD DATA ---------- */
async function loadMenuOfTheDay() {
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  
  // Cutoff 9 PM (21 * 60)
  if (minutesNow >= 21 * 60) {
    disableMotd();
    return;
  }

  const container = document.getElementById("motd-content");

  try {
    const res = await fetch(MOTD_JSON, { cache: "no-store" });
    const data = await res.json();

    const availableItems = (data.items || []).filter(
      (i) => i.available !== false
    );

    if (!availableItems.length) {
      disableMotd();
      return;
    }

    motdEnabled = true;
    motdData = { ...data, items: availableItems };

    if (container) {
      renderMotdItems(availableItems);
    }
    
    // Auto-open if session key implies it (logic in init) or triggered manually later
    if (sessionStorage.getItem(MOTD_SESSION_KEY) === "true" && document.readyState === "complete") {
       // logic to open if needed, currently we only set key
    }

  } catch (e) {
    disableMotd();
  }
}

function disableMotd() {
  motdEnabled = false;
  const btn = document.querySelector(".motd-btn"); // targeted via class in HTML
  const modal = document.getElementById("motd-modal");
  if (btn) btn.style.display = "none";
  if (modal) modal.remove();
}

/* ---------- RENDER ---------- */
function renderMotdItems(items) {
  const c = document.getElementById("motd-content");
  if (!c) return;

  c.innerHTML = "";
  
  // Re-check time for rendering disabled state
  const d = new Date();
  const orderingAllowed = (d.getHours() * 60 + d.getMinutes()) < 21 * 60;
  const isClosedToday =
    typeof kitchenClosedToday === "function" &&
    kitchenClosedToday() &&
    (typeof orderDay === "undefined" || orderDay === "today");
  const earlyCutoff =
    typeof nowMinutes === "function" && orderDay !== "tomorrow"
      ? nowMinutes() < 7 * 60
      : false;

  const grid = document.createElement("div");
  grid.className = "menu-grid";

  items.forEach((item, idx) => {
    const id = `motd__${item.name}`;
    const encodedId = encodeURIComponent(id);
    const domKey =
      typeof safeItemKey === "function"
        ? safeItemKey(id)
        : id.replace(/\W+/g, "_");
    const qty =
      (typeof selectedItems !== "undefined" && selectedItems[id]?.qty) || 0;

    const available =
      orderingAllowed && !isClosedToday && !earlyCutoff && item.available !== false;
    const minusDisabled = !available || qty <= 0 ? "disabled" : "";
    const plusDisabled = !available ? "disabled" : "";
    const plusActive = available && qty > 0 ? " qty-plus-active" : "";

    const card = document.createElement("div");
    card.className = `menu-item ${available ? "" : "disabled"}`;
    card.dataset.itemKey = domKey;
    card.style.animationDelay = `${idx * 40}ms`;

    card.innerHTML = `
      <div>
        <div class="item-name">
          <span class="food-indicator ${item.veg ? "veg" : "non-veg"}"></span>
          ${item.name}
        </div>
        ${item.description ? `<div class="item-desc">${item.description}</div>` : ""}
        <div class="item-price">Rs. ${item.price}</div>
      </div>
      <div class="qty-box">
        <button class="qty-btn qty-minus" data-item-key="${domKey}" data-action="minus" ${minusDisabled} aria-label="Remove ${item.name}" onclick="updateMotdQty('${encodedId}','${item.name}',${item.price},-1)">−</button>
        <span class="menu-qty" data-id="${id}">${qty}</span>
        <button class="qty-btn qty-plus${plusActive}" data-item-key="${domKey}" data-action="plus" ${plusDisabled} aria-label="Add ${item.name}" onclick="updateMotdQty('${encodedId}','${item.name}',${item.price},1)">+</button>
      </div>
    `;

    grid.appendChild(card);
  });

  c.appendChild(grid);
}

/* ---------- QTY HANDLER ---------- */
function updateMotdQty(safeId, name, price, delta) {
  const id = decodeURIComponent(safeId);
  
  // Calls global function from menu.js
  if (typeof updateQty === "function") {
    updateQty(id, name, price, delta);
  }
}
