const { describe, test } = require("node:test");
const assert = require("node:assert");
const {
  isDateClosed, matchesFilters,
  getCartSubtotal, getFreeEligibleSubtotal,
  validateCoupon, updateQty, toggleExtra,
} = require("../public/menu-logic");

const COUPONS = {
  FLAT50:  { discount: 50,  minOrder: 200, active: true,  isPercent: false },
  PCT10:   { discount: 10,  minOrder: 0,   active: true,  isPercent: true, maxDiscount: 100 },
  FREEDEL: { discount: 0,   minOrder: 0,   active: true,  freeDelivery: true, freeDeliveryOnly: true },
  OFF:     { discount: 50,  minOrder: 0,   active: false },
};

/* ── updateQty ── */
describe("updateQty", () => {
  test("adds item", () => {
    const s = updateQty({}, "lunch__rice", "Rice", 80, 1);
    assert.strictEqual(s["lunch__rice"].qty, 1);
  });

  test("increments qty", () => {
    let s = updateQty({}, "lunch__rice", "Rice", 80, 1);
    s = updateQty(s, "lunch__rice", "Rice", 80, 1);
    assert.strictEqual(s["lunch__rice"].qty, 2);
  });

  test("removes item when qty reaches 0", () => {
    let s = updateQty({}, "lunch__rice", "Rice", 80, 1);
    s = updateQty(s, "lunch__rice", "Rice", 80, -1);
    assert.strictEqual(s["lunch__rice"], undefined);
  });

  test("no-ops decrement on empty cart", () => {
    const s = updateQty({}, "lunch__rice", "Rice", 80, -1);
    assert.strictEqual(s["lunch__rice"], undefined);
  });
});

/* ── getCartSubtotal ── */
describe("getCartSubtotal", () => {
  test("returns 0 for empty cart", () => {
    assert.strictEqual(getCartSubtotal({}), 0);
  });

  test("sums qty × price", () => {
    let s = updateQty({}, "lunch__rice", "Rice", 80, 2);
    s = updateQty(s, "lunch__dal", "Dal", 60, 1);
    assert.strictEqual(getCartSubtotal(s), 220);
  });
});

/* ── toggleExtra ── */
describe("toggleExtra", () => {
  test("adds extra", () => {
    let s = updateQty({}, "lunch__rice", "Rice", 80, 1);
    s = toggleExtra(s, "lunch__rice", "Raita", 30, true);
    assert.strictEqual(s["lunch__rice"].extras["Raita"], 30);
  });

  test("removes extra", () => {
    let s = updateQty({}, "lunch__rice", "Rice", 80, 1);
    s = toggleExtra(s, "lunch__rice", "Raita", 30, true);
    s = toggleExtra(s, "lunch__rice", "Raita", 30, false);
    assert.strictEqual(s["lunch__rice"].extras["Raita"], undefined);
  });

  test("no-ops when item not in cart", () => {
    const s = toggleExtra({}, "lunch__rice", "Raita", 30, true);
    assert.strictEqual(s["lunch__rice"], undefined);
  });
});

/* ── getFreeEligibleSubtotal ── */
describe("getFreeEligibleSubtotal", () => {
  test("excludes seafood items", () => {
    let s = updateQty({}, "seafood_starters__prawns", "Prawns", 200, 1);
    s = updateQty(s, "lunch__rice", "Rice", 80, 1);
    assert.strictEqual(getFreeEligibleSubtotal(s), 80);
  });

  test("includes extras in eligible total", () => {
    let s = updateQty({}, "lunch__rice", "Rice", 80, 1);
    s = toggleExtra(s, "lunch__rice", "Raita", 30, true);
    assert.strictEqual(getFreeEligibleSubtotal(s), 110);
  });
});

/* ── validateCoupon ── */
describe("validateCoupon", () => {
  test("applies flat discount when subtotal meets minimum", () => {
    const r = validateCoupon("FLAT50", 300, COUPONS);
    assert.strictEqual(r.discountAmount, 50);
    assert.strictEqual(r.appliedCoupon, "FLAT50");
  });

  test("does not apply when subtotal below minimum", () => {
    const r = validateCoupon("FLAT50", 100, COUPONS);
    assert.strictEqual(r.discountAmount, 0);
    assert.strictEqual(r.appliedCoupon, null);
  });

  test("applies percent discount", () => {
    const r = validateCoupon("PCT10", 500, COUPONS);
    assert.strictEqual(r.discountAmount, 50);
  });

  test("percent discount capped at maxDiscount", () => {
    const r = validateCoupon("PCT10", 2000, COUPONS);
    assert.strictEqual(r.discountAmount, 100);
  });

  test("freeDeliveryOnly sets freeDeliveryTarget to 0", () => {
    const r = validateCoupon("FREEDEL", 0, COUPONS);
    assert.strictEqual(r.freeDeliveryTarget, 0);
    assert.strictEqual(r.discountAmount, 0);
  });

  test("inactive coupon is ignored", () => {
    const r = validateCoupon("OFF", 500, COUPONS);
    assert.strictEqual(r.discountAmount, 0);
    assert.strictEqual(r.appliedCoupon, null);
  });

  test("unknown coupon is ignored", () => {
    const r = validateCoupon("FAKE", 500, COUPONS);
    assert.strictEqual(r.discountAmount, 0);
  });
});

/* ── matchesFilters ── */
describe("matchesFilters", () => {
  test("returns true with no filters", () => {
    assert.strictEqual(matchesFilters({ name: "Rice", veg: true, price: 80 }), true);
  });

  test("vegOnly filters out non-veg", () => {
    assert.strictEqual(matchesFilters({ name: "Chicken", veg: false }, { vegOnly: true }), false);
    assert.strictEqual(matchesFilters({ name: "Dal", veg: true }, { vegOnly: true }), true);
  });

  test("searchQuery filters by name", () => {
    assert.strictEqual(matchesFilters({ name: "Chicken Curry" }, { searchQuery: "chicken" }), true);
    assert.strictEqual(matchesFilters({ name: "Rice" }, { searchQuery: "chicken" }), false);
  });

  test("searchQuery matches description", () => {
    assert.strictEqual(
      matchesFilters({ name: "Rice", description: "Spicy basmati" }, { searchQuery: "spicy" }),
      true
    );
  });
});

/* ── isDateClosed ── */
describe("isDateClosed", () => {
  test("returns false with no closures", () => {
    assert.strictEqual(isDateClosed(new Date()), false);
  });

  test("returns true when date falls within closure range", () => {
    const closures = [{ start_date: "2030-01-01", end_date: "2030-01-07" }];
    assert.strictEqual(isDateClosed(new Date("2030-01-04"), { kitchenClosures: closures }), true);
  });

  test("returns false when date is outside closure range", () => {
    const closures = [{ start_date: "2030-01-01", end_date: "2030-01-07" }];
    assert.strictEqual(isDateClosed(new Date("2030-01-10"), { kitchenClosures: closures }), false);
  });

  test("returns true when kitchenClosedToday is set for today", () => {
    const today = new Date();
    assert.strictEqual(isDateClosed(today, { kitchenClosedToday: true, today }), true);
  });

  test("kitchenClosedToday does not affect future dates", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.strictEqual(isDateClosed(tomorrow, { kitchenClosedToday: true }), false);
  });
});
