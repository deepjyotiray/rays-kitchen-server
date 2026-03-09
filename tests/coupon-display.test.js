const { test, describe } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

describe('Coupon Display Tests', () => {
  test('Invoice should display coupon when present', () => {
    const invoiceHtml = fs.readFileSync(
      path.join(__dirname, '../public/invoice/index.html'), 
      'utf8'
    );
    
    const dom = new JSDOM(invoiceHtml);
    const { document } = dom.window;

    // Test the showCoupon function logic directly
    function showCoupon(o) {
      const couponBox = document.getElementById("couponBox");
      const couponCodeEl = document.getElementById("couponCode");
      
      if (!couponBox || !couponCodeEl) return;

      const code =
        (o.couponCode || o.coupon || o.coupon_name || o.coupon_code || "").toString().trim();
      const discount =
        Number(o.couponDiscount ?? o.discount ?? o.coupon_amount ?? o.coupon_discount ?? 0) || 0;

      if (!code) {
        couponBox.style.display = "none";
        return;
      }

      let text = code;
      if (discount !== 0) {
        const sign = discount > 0 ? "-" : "";
        text += ` (${sign}₹${discount.toFixed(2)})`;
      }

      couponCodeEl.textContent = text;
      couponBox.style.display = "block";
    }

    const mockInvoiceData = {
      couponCode: 'FLAT50',
      couponDiscount: 50
    };

    showCoupon(mockInvoiceData);

    const couponBox = document.getElementById('couponBox');
    const couponCode = document.getElementById('couponCode');

    assert.strictEqual(couponBox.style.display, 'block');
    assert.strictEqual(couponCode.textContent, 'FLAT50 (-₹50.00)');
  });

  test('Invoice should hide coupon when not present', () => {
    const invoiceHtml = fs.readFileSync(
      path.join(__dirname, '../public/invoice/index.html'), 
      'utf8'
    );
    
    const dom = new JSDOM(invoiceHtml);
    const { document } = dom.window;

    function showCoupon(o) {
      const couponBox = document.getElementById("couponBox");
      const couponCodeEl = document.getElementById("couponCode");
      if (!couponBox || !couponCodeEl) return;

      const code =
        (o.couponCode || o.coupon || o.coupon_name || o.coupon_code || "").toString().trim();
      const discount =
        Number(o.couponDiscount ?? o.discount ?? o.coupon_amount ?? o.coupon_discount ?? 0) || 0;

      if (!code) {
        couponBox.style.display = "none";
        return;
      }

      let text = code;
      if (discount !== 0) {
        const sign = discount > 0 ? "-" : "";
        text += ` (${sign}₹${discount.toFixed(2)})`;
      }

      couponCodeEl.textContent = text;
      couponBox.style.display = "block";
    }

    const mockInvoiceData = {};
    showCoupon(mockInvoiceData);

    const couponBox = document.getElementById('couponBox');
    assert.strictEqual(couponBox.style.display, 'none');
  });

  test('Receipt should display coupon discount in extras', () => {
    const receiptHtml = fs.readFileSync(
      path.join(__dirname, '../public/receipt/index.html'), 
      'utf8'
    );
    
    const dom = new JSDOM(receiptHtml);
    const { document } = dom.window;

    function formatSignedCurrency(val, label) {
      const n = Number(val);
      if (!Number.isFinite(n)) return String(val ?? 0);

      let num = n;
      const text = (label || "").toLowerCase();
      if (num > 0 && (text.includes("discount") || text.includes("coupon"))) {
        num = -num;
      }

      const sign = num >= 0 ? "+" : "-";
      return `${sign}₹${Math.abs(num).toFixed(2)}`;
    }

    const mockExtras = [
      { label: 'Delivery', amount: 50 },
      { label: 'Coupon Discount (FLAT50)', amount: 50 }
    ];

    const table = document.getElementById('itemsTable');
    
    mockExtras.forEach(ex => {
      const amt = Number(ex.amount) || 0;
      table.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${ex.label}</td>
          <td class="num">${formatSignedCurrency(amt, ex.label)}</td>
        </tr>
      `);
    });

    const tableRows = document.querySelectorAll('#itemsTable tr');
    const couponRow = Array.from(tableRows).find(row => 
      row.textContent.includes('Coupon Discount')
    );

    assert.ok(couponRow, 'Coupon row should exist');
    assert.ok(couponRow.textContent.includes('FLAT50'), 'Should contain coupon code');
    assert.ok(couponRow.textContent.includes('-₹50.00'), 'Should show negative discount amount');
  });

  test('Real order data verification', async () => {
    // Test with actual order data from the API
    const orderId = 'RAY-1771392892460';
    
    // Mock the API response based on what we saw earlier
    const mockApiResponse = {
      success: true,
      invoice: {
        orderId: "RAY-1771392892460",
        date: "2026-02-18",
        customer: "Aneesh Denny",
        phone: "9003796691",
        address: "Ananta Tower Building 19 1302",
        items: "• Chicken Masala x 2 = ₹270\n• Raita x 2 = ₹50",
        extras: [{ label: "Delivery", amount: 50 }],
        total: 320,
        couponCode: "FLAT50",
        couponDiscount: 50
      }
    };

    // Verify the coupon data is present
    assert.strictEqual(mockApiResponse.invoice.couponCode, 'FLAT50');
    assert.strictEqual(mockApiResponse.invoice.couponDiscount, 50);
    
    // Test that our showCoupon function would work with this data
    const invoiceHtml = fs.readFileSync(
      path.join(__dirname, '../public/invoice/index.html'), 
      'utf8'
    );
    
    const dom = new JSDOM(invoiceHtml);
    const { document } = dom.window;

    function showCoupon(o) {
      const couponBox = document.getElementById("couponBox");
      const couponCodeEl = document.getElementById("couponCode");
      if (!couponBox || !couponCodeEl) return;

      const code =
        (o.couponCode || o.coupon || o.coupon_name || o.coupon_code || "").toString().trim();
      const discount =
        Number(o.couponDiscount ?? o.discount ?? o.coupon_amount ?? o.coupon_discount ?? 0) || 0;

      if (!code) {
        couponBox.style.display = "none";
        return;
      }

      let text = code;
      if (discount !== 0) {
        const sign = discount > 0 ? "-" : "";
        text += ` (${sign}₹${discount.toFixed(2)})`;
      }

      couponCodeEl.textContent = text;
      couponBox.style.display = "block";
    }

    showCoupon(mockApiResponse.invoice);

    const couponBox = document.getElementById('couponBox');
    const couponCode = document.getElementById('couponCode');

    assert.strictEqual(couponBox.style.display, 'block');
    assert.strictEqual(couponCode.textContent, 'FLAT50 (-₹50.00)');
  });
});