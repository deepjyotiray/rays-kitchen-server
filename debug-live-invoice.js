#!/usr/bin/env node

const https = require('https');

function testInvoicePage() {
  return new Promise((resolve, reject) => {
    const url = 'https://healthymealspot.com/invoice?orderId=RAY-1771392892460';
    
    https.get(url, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        // Check if coupon box exists
        const hasCouponBox = html.includes('id="couponBox"');
        const hasCouponCode = html.includes('id="couponCode"');
        const hasShowCouponFunction = html.includes('function showCoupon');
        const hasUpdatedFunction = html.includes('o.coupon_code');
        
        console.log('=== LIVE PAGE ANALYSIS ===');
        console.log('Has coupon box element:', hasCouponBox ? '✅' : '❌');
        console.log('Has coupon code element:', hasCouponCode ? '✅' : '❌');
        console.log('Has showCoupon function:', hasShowCouponFunction ? '✅' : '❌');
        console.log('Has updated function (checks o.coupon_code):', hasUpdatedFunction ? '✅' : '❌');
        
        // Check initial coupon box state
        const couponBoxMatch = html.match(/id="couponBox"[^>]*style="[^"]*display:\s*([^;"]*)/);
        if (couponBoxMatch) {
          console.log('Initial coupon box display:', couponBoxMatch[1]);
        }
        
        resolve();
      });
    }).on('error', reject);
  });
}

async function testAPI() {
  return new Promise((resolve, reject) => {
    const url = 'https://admin.healthymealspot.com/invoice?orderId=RAY-1771392892460';
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('\n=== API DATA ===');
          console.log('Coupon Code:', json.invoice.couponCode);
          console.log('Coupon Discount:', json.invoice.couponDiscount);
          console.log('Has coupon data:', !!(json.invoice.couponCode && json.invoice.couponDiscount) ? '✅' : '❌');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    await testInvoicePage();
    await testAPI();
    
    console.log('\n=== DIAGNOSIS ===');
    console.log('The coupon should display if:');
    console.log('1. API returns coupon data ✅');
    console.log('2. showCoupon function exists ✅');
    console.log('3. Function checks o.coupon_code ✅');
    console.log('4. JavaScript executes without errors');
    console.log('\nIf coupon still not showing, try:');
    console.log('- Hard refresh (Ctrl+F5 or Cmd+Shift+R)');
    console.log('- Clear browser cache');
    console.log('- Check browser console for JavaScript errors');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();