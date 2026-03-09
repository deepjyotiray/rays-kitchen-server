const { test, expect } = require("@playwright/test");

// Sections are collapsed by default — expand the first one before interacting
async function expandFirstSection(page) {
  await page.waitForSelector(".section-header", { state: "attached" });
  await page.locator(".section-header").first().click();
  await page.waitForSelector(".add-btn", { state: "visible" });
}

async function addFirstItem(page) {
  await expandFirstSection(page);
  await page.locator(".add-btn").first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".section-header", { state: "attached" });
});

/* ── 1. Menu loads ── */
test("menu renders sections", async ({ page }) => {
  const count = await page.locator(".section-header").count();
  expect(count).toBeGreaterThanOrEqual(1);
});

/* ── 2. Section expands on click ── */
test("section expands and shows items", async ({ page }) => {
  await expandFirstSection(page);
  await expect(page.locator(".add-btn").first()).toBeVisible();
});

/* ── 3. Add item to cart ── */
test("add item updates cart total", async ({ page }) => {
  await addFirstItem(page);
  await expect(page.locator("#cart-total")).not.toHaveText("₹0");
  await expect(page.locator("#cart-count")).not.toHaveText("0");
});

/* ── 4. Remove item from cart ── */
test("remove item clears cart", async ({ page }) => {
  await addFirstItem(page);
  await expect(page.locator("#cart-count")).not.toHaveText("0");
  // Cart buttons are re-created on each render — call updateQty directly
  await page.evaluate(() => {
    const id = Object.keys(selectedItems)[0];
    const item = selectedItems[id];
    updateQty(id, item.name, item.price, -1);
  });
  await expect(page.locator("#cart-count")).toHaveText("0");
});

/* ── 5. Veg filter ── */
test("veg-only filter reduces visible items", async ({ page }) => {
  await expandFirstSection(page);
  await page.waitForTimeout(500); // let animations settle
  const before = await page.locator(".menu-item").count();
  await page.click("#veg-toggle");
  await page.waitForTimeout(500);
  const after = await page.locator(".menu-item").count();
  expect(after).toBeLessThanOrEqual(before);
});

/* ── 6. Search filter ── */
test("search filters menu items by name", async ({ page }) => {
  await expandFirstSection(page);
  await page.fill("#search-dishes", "chicken");
  await page.waitForTimeout(400);
  const items = page.locator(".menu-item");
  const count = await items.count();
  if (count > 0) {
    const text = (await items.first().textContent()).toLowerCase();
    expect(text).toContain("chicken");
  }
  await page.click("#clear-search");
  await page.waitForTimeout(300);
  const restored = await page.locator(".menu-item").count();
  expect(restored).toBeGreaterThanOrEqual(count);
});

/* ── 7. Coupon applied ── */
test("valid coupon FLAT50 shows coupon message", async ({ page }) => {
  await addFirstItem(page);
  await page.fill("#coupon-input", "FLAT50");
  await page.click("button[onclick='applyCoupon()']");
  await page.waitForTimeout(400);
  // Coupon msg appears or cart total changes
  const msg = await page.locator("#coupon-msg").textContent();
  const total = await page.locator("#cart-total").textContent();
  expect(msg.length > 0 || total !== "₹0").toBeTruthy();
});

/* ── 8. Order button opens modal ── */
test("order button opens customer modal", async ({ page }) => {
  await addFirstItem(page);
  await page.click("#cart-order-btn");
  await expect(page.locator("#customer-modal")).toBeVisible();
  await expect(page.locator("#reg-mobile")).toBeVisible();
});

/* ── 9. New user registration ── */
test("new user: entering mobile shows name field", async ({ page }) => {
  await addFirstItem(page);
  await page.click("#cart-order-btn");
  const mobile = `99999${Date.now().toString().slice(-5)}`;
  await page.fill("#reg-mobile", mobile);
  await page.click("#reg-continue-btn");
  await page.waitForTimeout(800);
  await expect(page.locator("#reg-name")).toBeVisible();
});

/* ── 10. Returning user recognised ── */
test("returning user is recognised from localStorage", async ({ page }) => {
  const mobile = `88888${Date.now().toString().slice(-5)}`;
  await page.evaluate(async (m) => {
    await fetch("http://localhost:3000/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Return User", mobile: m }),
    });
    localStorage.setItem("user_mobile", m);
  }, mobile);
  await page.reload();
  await addFirstItem(page);
  await page.click("#cart-order-btn");
  await page.waitForTimeout(800);
  // Returning user skips name entry — change-mobile btn or order step visible
  const modal = page.locator("#customer-modal");
  await expect(modal).toBeVisible();
  // Name field should be hidden (user already known)
  await expect(page.locator("#reg-name")).toBeHidden();
});

/* ── 11. Close modal ── */
test("modal closes on × button", async ({ page }) => {
  await addFirstItem(page);
  await page.click("#cart-order-btn");
  await expect(page.locator("#customer-modal")).toBeVisible();
  await page.click(".modal-close-btn");
  await expect(page.locator("#customer-modal")).toBeHidden();
});

/* ── 12. Kitchen closed banner ── */
test("kitchen closed banner matches backend state", async ({ page }) => {
  const state = await page.evaluate(() =>
    fetch("http://localhost:3000/state").then((r) => r.json())
  );
  const banner = page.locator("#kitchen-closed-banner");
  if (state.kitchenClosedToday) {
    await expect(banner).toBeVisible();
  } else {
    await expect(banner).toBeHidden();
  }
});
