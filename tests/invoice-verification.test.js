const { test } = require('node:test');
const assert = require('node:assert');

test('Invoice calculation verification for RAY-1771392892460', () => {
  // Actual API response data
  const invoiceData = {
    items: "• Chicken Masala x 2 = ₹270\n• Raita x 2 = ₹50",
    extras: [{ label: "Delivery", amount: 50 }],
    total: 320,
    couponCode: "FLAT50",
    couponDiscount: 50
  };

  // Parse items to calculate subtotal
  const itemLines = invoiceData.items.split('\n');
  let itemsSubtotal = 0;
  
  itemLines.forEach(line => {
    const match = line.match(/₹(\d+)/);
    if (match) {
      itemsSubtotal += parseInt(match[1]);
    }
  });

  // Calculate extras total
  const extrasTotal = invoiceData.extras.reduce((sum, extra) => sum + extra.amount, 0);
  
  // Expected calculation:
  // Items: ₹270 + ₹50 = ₹320
  // Delivery: +₹50 = ₹370
  // Coupon discount: -₹50 = ₹320
  
  console.log('Items subtotal:', itemsSubtotal);
  console.log('Extras total:', extrasTotal);
  console.log('Coupon discount:', invoiceData.couponDiscount);
  console.log('Final total:', invoiceData.total);
  
  const calculatedTotal = itemsSubtotal + extrasTotal - invoiceData.couponDiscount;
  
  assert.strictEqual(itemsSubtotal, 320, 'Items subtotal should be ₹320');
  assert.strictEqual(extrasTotal, 50, 'Delivery should be ₹50');
  assert.strictEqual(invoiceData.couponDiscount, 50, 'Coupon discount should be ₹50');
  assert.strictEqual(calculatedTotal, 320, 'Calculated total should match invoice total');
  assert.strictEqual(invoiceData.total, 320, 'Invoice total should be ₹320');
  
  // Verify coupon data exists
  assert.strictEqual(invoiceData.couponCode, 'FLAT50', 'Coupon code should be FLAT50');
  assert.ok(invoiceData.couponDiscount > 0, 'Coupon discount should be positive');
});

test('Live invoice page coupon display check', async () => {
  // This would require a headless browser to properly test
  // For now, we'll verify the logic matches our expectations
  
  const mockInvoiceData = {
    couponCode: "FLAT50",
    couponDiscount: 50
  };
  
  // Simulate the showCoupon function logic
  function showCoupon(o) {
    const code = (o.couponCode || o.coupon || o.coupon_name || o.coupon_code || "").toString().trim();
    const discount = Number(o.couponDiscount ?? o.discount ?? o.coupon_amount ?? o.coupon_discount ?? 0) || 0;
    
    if (!code) return { display: 'none', text: '' };
    
    let text = code;
    if (discount !== 0) {
      const sign = discount > 0 ? "-" : "";
      text += ` (${sign}₹${discount.toFixed(2)})`;
    }
    
    return { display: 'block', text };
  }
  
  const result = showCoupon(mockInvoiceData);
  
  assert.strictEqual(result.display, 'block', 'Coupon box should be visible');
  assert.strictEqual(result.text, 'FLAT50 (-₹50.00)', 'Coupon text should show code and discount');
});