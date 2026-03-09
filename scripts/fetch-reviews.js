const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REVIEWS_PATH = path.join(__dirname, '../public/reviews.json');
const URL = "https://www.google.com/maps/place/Mr+and+Mrs+Ray's+Home+Kitchen/@18.9732131,73.0255387,992m/data=!3m1!1e3!4m8!3m7!1s0x3be7c320de643e41:0x4de84dbb75c98167!8m2!3d18.9732131!4d73.0281136!9m1!1b1!16s%2Fg%2F11yx7l4gjx?entry=ttu&g_ep=EgoyMDI2MDIyNS4wIKXMDSoASAFQAw%3D%3D";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // Scroll .DxyBCb until no new cards load
  let prevCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => document.querySelector('.DxyBCb')?.scrollBy(0, 3000));
    await page.waitForTimeout(1500);
    const count = await page.evaluate(() => document.querySelectorAll('.jJc9Ad').length);
    console.log(`Cards loaded: ${count}`);
    if (count === prevCount && i > 2) break;
    prevCount = count;
  }

  // Expand all truncated reviews
  const moreButtons = await page.locator('button.w8nwRe').all();
  for (const btn of moreButtons) {
    try { await btn.click(); await page.waitForTimeout(100); } catch {}
  }

  const scraped = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.jJc9Ad')).map(card => ({
      name: card.querySelector('.d4r55')?.innerText?.trim() || '',
      stars: parseInt(card.querySelector('.kvMYJc')?.getAttribute('aria-label') || '5') || 5,
      text: card.querySelector('.wiI7pd')?.innerText?.trim() || '',
      image: card.querySelector('img.NBa7we')?.src || ''
    })).filter(r => r.name);
  });

  console.log(`Scraped ${scraped.length} reviews`);

  const existing = JSON.parse(fs.readFileSync(REVIEWS_PATH, 'utf8'));
  const existingNames = new Set(existing.reviews.map(r => r.name));
  const newReviews = scraped.filter(r => !existingNames.has(r.name));

  existing.reviews.push(...newReviews);
  existing.totalReviews = existing.reviews.length;
  fs.writeFileSync(REVIEWS_PATH, JSON.stringify(existing, null, 2));
  console.log(`Done. Added ${newReviews.length} new. Total: ${existing.reviews.length}`);

  await browser.close();
})();
