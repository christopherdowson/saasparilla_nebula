import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args:['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, ignoreHTTPSErrors:true });
const page = await ctx.newPage();
await page.goto(process.argv[2],{waitUntil:'networkidle'});
await page.screenshot({path: process.argv[3]});
const html = await page.evaluate(()=>document.body.outerHTML.replace(/<svg.*?<\/svg>/gs,'<svg/>').replace(/<script.*?<\/script>/gs,'').replace(/\s+/g,' '));
console.log(html.slice(0,3500));
await browser.close();
