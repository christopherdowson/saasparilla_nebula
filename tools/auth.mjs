import { chromium } from 'playwright-core';
const [,, base, user, pass, otp, statePath] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, ignoreHTTPSErrors:true });
const page = await ctx.newPage();
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.fill('input[name="login[username]"]', user);
await page.fill('input[name="login[password]"]', pass);
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('button[type="submit"]')]);
console.log('after login:', await page.title(), page.url().replace(/key\/[0-9a-f]+\//,'key/…/'));
const code = page.locator('#tfa-code, input[x-model="code"], input[name="tfa_code"]').first();
if (await code.count()) {
  await code.fill(otp);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{}), page.click('form button[type="submit"]')]);
  await page.waitForTimeout(1500);
}
console.log('after tfa:', await page.title(), page.url().replace(/key\/[0-9a-f]+\//,'key/…/'));
await ctx.storageState({ path: statePath });
await browser.close();
