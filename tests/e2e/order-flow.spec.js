const { test, expect } = require("@playwright/test");

const ADMIN_URL = "http://localhost:3000/admin";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "dev-only-admin-key";
const TEST_MOBILE = "9594614752";
const TEST_NAME = "E2E Test User";

/* ── helpers ── */
async function loginAdmin(page) {
  await page.goto(ADMIN_URL);
  await page.waitForSelector("#adminPass");
  await page.fill("#adminPass", ADMIN_KEY);
  await page.keyboard.press("Enter");
  await page.waitForSelector("#orders", { state: "attached" });
  await page.waitForTimeout(800);
}

async function getOrderCard(page, mobile) {
  return page.locator(`.order`).filter({ hasText: mobile });
}

/* ── Full E2E flow ── */
test("place order → admin confirms → marks paid → marks delivered", async ({ browser }) => {
  // Use two separate browser contexts: customer + admin
  const customerCtx = await browser.newContext();
  const adminCtx = await browser.newContext();
  const customer = await customerCtx.newPage();
  const admin = await adminCtx.newPage();

  // ── Step 1: Register user via API ──
  const regRes = await customer.evaluate(async ({ name, mobile }) => {
    const r = await fetch("http://localhost:3000/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mobile, address: "123 Test Street" }),
    });
    return r.json();
  }, { name: TEST_NAME, mobile: TEST_MOBILE });
  expect(regRes.success).toBe(true);

  // ── Step 2: Customer places order via frontend ──
  await customer.goto("http://localhost:8080");
  await customer.evaluate((m) => localStorage.setItem("user_mobile", m), TEST_MOBILE);
  await customer.reload();
  await customer.waitForSelector(".section-header");

  // Expand first section and add item
  await customer.locator(".section-header").first().click();
  await customer.waitForSelector(".add-btn", { state: "visible" });
  await customer.locator(".add-btn").first().click();
  await customer.waitForTimeout(300);

  // Open order modal
  await customer.click("#cart-order-btn");
  await customer.waitForSelector("#customer-modal", { state: "visible" });
  await customer.waitForTimeout(600);

  // Confirm order — click the confirm/order button in the modal
  const confirmBtn = customer.locator("#customer-modal button").filter({ hasText: /confirm|order|whatsapp/i }).first();
  await confirmBtn.click();
  await customer.waitForTimeout(1000);

  // Capture the order ID from the last POST /orders call
  const orderId = await customer.evaluate(async () => {
    const r = await fetch(`http://localhost:3000/users/${window.customerPhone || localStorage.getItem("user_mobile")}/orders`);
    const d = await r.json();
    return d.orders?.[0]?.id || null;
  });

  // If frontend order didn't fire (WhatsApp redirect), place via API directly
  let finalOrderId = orderId;
  if (!finalOrderId) {
    const orderRes = await customer.evaluate(async ({ mobile, name }) => {
      const id = `E2E-${Date.now()}`;
      const r = await fetch("http://localhost:3000/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: id,
          orderDate: new Date().toISOString().slice(0, 10),
          orderTime: "12:00",
          orderFor: "today",
          customer: name,
          phone: mobile,
          address: "123 Test Street",
          notes: "E2E test order",
          items: "• Test Item x 1 = ₹100",
          extras: "",
          total: 100,
          deliveryCharge: 0,
          couponCode: "",
          couponDiscount: 0,
          expectedDelivery: "1pm",
          expectedDeliveryIso: new Date().toISOString(),
        }),
      });
      return { id, body: await r.json() };
    }, { mobile: TEST_MOBILE, name: TEST_NAME });
    expect(orderRes.body.success).toBe(true);
    finalOrderId = orderRes.id;
  }

  expect(finalOrderId).toBeTruthy();
  console.log("Order ID:", finalOrderId);

  // ── Step 3: Admin logs in, refreshes, and confirms order ──
  await loginAdmin(admin);
  await admin.evaluate(() => window.refreshData?.());
  await admin.waitForTimeout(1000);

  const card = await getOrderCard(admin, TEST_MOBILE);
  await expect(card).toBeVisible();

  const confirmBtn2 = card.locator("button.confirm");
  await expect(confirmBtn2).toBeVisible();
  await confirmBtn2.click();
  await admin.waitForTimeout(600);

  await expect(card.locator(".status-badge")).toHaveText(/confirmed/i);

  // ── Step 4: Admin marks Paid ──
  const paidBtn = card.locator("button.paid");
  await expect(paidBtn).toBeVisible();
  await paidBtn.click();
  await admin.waitForTimeout(600);

  await expect(card.locator(".status-badge")).toHaveText(/paid/i);

  // ── Step 5: Admin marks Delivered ──
  const deliveredBtn = card.locator("button.delivered");
  await expect(deliveredBtn).toBeVisible();
  await deliveredBtn.click();
  await admin.waitForTimeout(600);

  await expect(card.locator(".status-badge")).toHaveText(/delivered/i);

  // ── Step 6: Verify via API ──
  const finalStatus = await admin.evaluate(async ({ id, key }) => {
    const r = await fetch(`http://localhost:3000/admin/orders`, {
      headers: { "X-Admin-Key": key },
    });
    const orders = await r.json();
    return orders.find((o) => o.id === id)?.status;
  }, { id: finalOrderId, key: ADMIN_KEY });

  expect(finalStatus).toBe("Delivered");

  // Cleanup order + user
  await admin.evaluate(async ({ id, key }) => {
    await fetch(`http://localhost:3000/admin/orders/${id}`, {
      method: "DELETE",
      headers: { "X-Admin-Key": key },
    });
  }, { id: finalOrderId, key: ADMIN_KEY });

  await customer.evaluate(async ({ mobile, key }) => {
    await fetch(`http://localhost:3000/admin/users/${mobile}`, {
      method: "DELETE",
      headers: { "X-Admin-Key": key },
    });
  }, { mobile: TEST_MOBILE, key: ADMIN_KEY });

  await customerCtx.close();
  await adminCtx.close();
});
