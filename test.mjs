import playwright from 'playwright';

const browser = await playwright.chromium.connectOverCDP('ws://localhost:9223/cdp');
const context = browser.contexts()[0];
const page = context.pages()[0];
console.log('connected to page:', page.url());
await page.goto('https://example.com')
console.log('connected to page:', page.url());
await browser.close();