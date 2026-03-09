#!/usr/bin/env node

const https = require('https');

function fetchInvoice() {
  return new Promise((resolve, reject) => {
    const url = 'https://admin.healthymealspot.com/invoice?orderId=RAY-1771392892460';
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    const response = await fetchInvoice();
    
    console.log('=== INVOICE DATA VERIFICATION ===');
    console.log('Order ID:', response.invoice.orderId);
    console.log('Customer:', response.invoice.customer);
    console.log('Total:', response.invoice.total);
    console.log('Coupon Code:', response.invoice.couponCode);
    console.log('Coupon Discount:', response.invoice.couponDiscount);
    
    console.log('\n=== CALCULATION CHECK ===');
    
    // Parse items
    const itemLines = response.invoice.items.split('\n');
    let itemsTotal = 0;
    itemLines.forEach(line => {
      const match = line.match(/₹(\d+)/);
      if (match) {
        itemsTotal += parseInt(match[1]);
        console.log('Item:', line.trim(), '→', match[1]);
      }
    });
    
    // Parse extras
    let extrasTotal = 0;
    response.invoice.extras.forEach(extra => {
      extrasTotal += extra.amount;
      console.log('Extra:', extra.label, '→', extra.amount);
    });
    
    const couponDiscount = response.invoice.couponDiscount || 0;
    const calculatedTotal = itemsTotal + extrasTotal - couponDiscount;
    
    console.log('\n=== TOTALS ===');
    console.log('Items subtotal:', itemsTotal);
    console.log('Extras total:', extrasTotal);
    console.log('Coupon discount:', couponDiscount);
    console.log('Calculated total:', calculatedTotal);
    console.log('API total:', response.invoice.total);
    console.log('Match:', calculatedTotal === response.invoice.total ? '✅' : '❌');
    
    console.log('\n=== COUPON DISPLAY CHECK ===');
    console.log('Has coupon code:', !!response.invoice.couponCode ? '✅' : '❌');
    console.log('Has coupon discount:', !!response.invoice.couponDiscount ? '✅' : '❌');
    
    if (response.invoice.couponCode) {
      console.log('Expected display text:', `${response.invoice.couponCode} (-₹${response.invoice.couponDiscount.toFixed(2)})`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();