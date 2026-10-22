import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [,, statePath, outJson, ...specs] = process.argv;
const axeSrc = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, ignoreHTTPSErrors:true, storageState: statePath });
const page = await ctx.newPage();
const report = [];
for (const spec of specs) {
  const [name, url, mode] = spec.split('|');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(m => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
  await page.waitForTimeout(500);
  await page.addScriptTag({ content: axeSrc });
  const res = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, samples: v.nodes.slice(0, 3).map(n => ({ target: n.target.join(' ').slice(0, 110), summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220) })) }));
  });
  report.push({ name, mode, violations: res });
  console.log(name, mode, '->', res.length, 'rules,', res.reduce((a, v) => a + v.nodes, 0), 'nodes');
}
fs.writeFileSync(outJson, JSON.stringify(report, null, 1));
await browser.close();
