import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [,, statePath, outJson, ...specs] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, ignoreHTTPSErrors:true, storageState: statePath });
const page = await ctx.newPage();
const report = {};
for (const spec of specs) {
  const [name, url, mode] = spec.split('|');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(m => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
  await page.waitForTimeout(500);
  report[name] = await page.evaluate(() => {
    const TW = new Set(['rgb(107, 114, 128)','rgb(156, 163, 175)','rgb(55, 65, 81)','rgb(17, 24, 39)','rgb(31, 41, 55)','rgb(243, 244, 246)','rgb(229, 231, 235)','rgb(209, 213, 219)','rgb(75, 85, 99)','rgb(249, 250, 251)','rgb(255, 255, 255)','rgb(0, 0, 0)','rgb(99, 102, 241)','rgb(79, 70, 229)','rgb(224, 231, 255)','rgb(238, 242, 255)','rgb(226, 232, 240)','rgb(148, 163, 184)','rgb(30, 41, 59)','rgb(15, 23, 42)','rgb(36, 41, 51)']);
    const ORANGE = /rgb\(237, 128, 8\)|rgb\(212, 114, 10\)|rgb\(244, 154, 55\)|rgb\(201, 109, 7\)/;
    const sig = (el) => { const c = el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(x => /^(nebula-|sp-|page-|action|btn|chart)/.test(x)).slice(0,3).join('.') : ''; return el.tagName.toLowerCase() + (c ? '.' + c : '') + (el.id ? '#' + el.id.slice(0,20) : ''); };
    const add = (bucket, key, el, extra) => { const b = (out[bucket] ||= {}); const e = (b[key] ||= { n: 0, samples: [] }); e.n++; if (e.samples.length < 3) e.samples.push(sig(el) + (extra ? ' ' + extra : '')); };
    const out = {};
    const els = [...document.querySelectorAll('body *')].filter(el => !(el instanceof SVGElement) && !el.closest('svg') && !el.closest('[x-cloak], dialog:not([open]), [hidden]'));
    let seen = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      seen++;
      const radius = cs.borderTopLeftRadius;
      if (radius !== '0px' && !(Math.abs(r.width - r.height) < 2 && parseFloat(radius) >= r.width / 2 - 1) && parseFloat(radius) > 0) add('rounded', radius, el, `${Math.round(r.width)}x${Math.round(r.height)}`);
      if (cs.boxShadow !== 'none' && !/inset 0px -2px/.test(cs.boxShadow) && !/inset 0px 1px 0px/.test(cs.boxShadow)) add('shadow', cs.boxShadow.slice(0, 60), el);
      if (/gradient/.test(cs.backgroundImage)) add('gradient', cs.backgroundImage.slice(0, 50), el);
      const bg = cs.backgroundColor; if (bg !== 'rgba(0, 0, 0, 0)' && TW.has(bg)) add('tailwind-bg', bg, el);
      if (TW.has(cs.color) && el.textContent.trim()) add('tailwind-text', cs.color, el);
      if (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0 && TW.has(cs.borderTopColor)) add('tailwind-border', cs.borderTopColor, el);
      const hasOwnText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (hasOwnText) {
        if (!/Archivo/.test(cs.fontFamily) && !/mono/i.test(cs.fontFamily)) add('font-family', cs.fontFamily.slice(0, 40), el);
        if (parseInt(cs.fontWeight) >= 700) add('weight-700+', cs.fontWeight, el);
        if (ORANGE.test(cs.color) && !el.closest('.nebula-btn--primary, .sp-tone-accent, .nebula-dashboard-lifetime-card, .nebula-chip, .nebula-switch-label--on, .nebula-notification-counter')) add('orange-text', cs.color, el);
        if (cs.textTransform === 'uppercase') add('uppercase-combos', `${cs.fontSize}/${cs.fontWeight}/${cs.letterSpacing}`, el);
      }
      if (el.matches('button, a.nebula-btn, .nebula-btn, input[type=submit]') && el.textContent.trim()) add('buttons', `${Math.round(r.height)}h bg=${cs.backgroundColor} border=${cs.borderTopWidth} ${cs.borderTopColor} fw=${cs.fontWeight} r=${cs.borderTopLeftRadius}`, el);
      if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')) add('inputs', `${Math.round(r.height)}h bg=${cs.backgroundColor} border=${cs.borderTopWidth} ${cs.borderTopColor} r=${cs.borderTopLeftRadius}`, el);
    }
    out._elements = seen;
    return out;
  });
  console.log(name, mode, 'elements', report[name]._elements);
}
fs.writeFileSync(outJson, JSON.stringify(report, null, 1));
await browser.close();
