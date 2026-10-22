import { chromium } from 'playwright-core';
const [,, statePath, ...urls] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, ignoreHTTPSErrors:true, storageState: statePath });
const page = await ctx.newPage();
for (const url of urls) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const rows = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll('.nebula-form-row, .nebula-config-row, .nebula-field')) {
      const label = row.querySelector('.nebula-form-row__label, .nebula-config-row__label, label');
      const control = row.querySelector('input:not([type=hidden]), select, textarea, .nebula-switch, [role=switch], button.nebula-switch');
      if (!label || !control) continue;
      const lr = label.getBoundingClientRect(), cr = control.getBoundingClientRect();
      if (!lr.height || !cr.height) continue;
      const kind = control.matches('.nebula-switch, [role=switch]') ? 'switch' : (control.type || control.tagName.toLowerCase());
      const range = document.createRange(); range.selectNodeContents(label); const tr = range.getBoundingClientRect();
      out.push({ label: label.textContent.trim().slice(0,28), kind, labelTextCentre: Math.round(tr.top + tr.height/2), controlCentre: Math.round(cr.top + cr.height/2), controlH: Math.round(cr.height), labelPadTop: getComputedStyle(label).paddingTop, rowAlign: getComputedStyle(row).alignItems });
    }
    return out;
  });
  console.log('=====', url.split('/admin/')[1]);
  for (const r of rows.slice(0, 14)) console.log(`${r.kind.padEnd(10)} ${String(r.labelTextCentre - r.controlCentre).padStart(4)}px  label=${r.label.padEnd(28)} controlH=${r.controlH} padTop=${r.labelPadTop} align=${r.rowAlign}`);
}
await browser.close();
