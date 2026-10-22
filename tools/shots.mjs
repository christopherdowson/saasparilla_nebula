import { chromium } from 'playwright-core';
const [,, statePath, outDir, ...pages] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, ignoreHTTPSErrors:true, storageState: statePath });
const page = await ctx.newPage();
for (const spec of pages) {
  const [name, url, mode, full, click] = spec.split('|');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(m => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
  if (click) { try { await page.click(click, { timeout: 8000 }); } catch (e) { console.log(name, "click failed:", click); } await page.waitForTimeout(400); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: full === 'full' });
  console.log(name, '->', await page.title());
}
await ctx.storageState({ path: statePath });
await browser.close();
