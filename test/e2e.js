// Temporärer Browser-Test (Puppeteer) für die StadtApp
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const OUT = process.env.OUT || "shots";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000/";
const results = [];
const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  try { const info = await fn(); results.push({ name, ok: true, info }); }
  catch (e) { results.push({ name, ok: false, error: String(e && e.stack || e) }); }
}

const visiblePins = (page) => page.$$eval(".leaflet-marker-pane .poi-pin:not(.is-draft)", (n) => n.length);
const clickText = (page, sel, text) => page.evaluate((sel, text) => {
  const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === text);
  if (!b) throw new Error("not found: " + text); b.click();
}, sel, text);

const openViaList = async (page, title) => {
  if (!(await page.$("#list-panel.is-open"))) await page.click("#btn-list");
  await page.waitForSelector("#list-panel.is-open");
  await page.evaluate((t) => [...document.querySelectorAll(".poi-item")].find((b) => b.querySelector(".title").textContent === t).click(), title);
  await page.waitForFunction((t) => ((document.querySelector(".leaflet-popup h3") || {}).textContent || "") === t, { timeout: 8000 }, title);
  await new Promise((r) => setTimeout(r, 400));
};
(async () => {
  const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--lang=de-DE"] });
  await browser.defaultBrowserContext().overridePermissions(BASE, ["geolocation"]);
  const page = await browser.newPage();
  await page.setGeolocation({ latitude: 48.9935, longitude: 8.4012 }); // Hauptbahnhof
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  await page.setViewport({ width: 1280, height: 800 });

  await step("load desktop, migrated POIs visible", async () => {
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelectorAll(".poi-pin").length >= 2, { timeout: 10000 });
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/01-desktop-map.png` });
    return await visiblePins(page);
  });

  await step("create POI with category", async () => {
    await page.click("#btn-new-poi");
    await page.mouse.click(560, 470);
    await page.waitForSelector("#poi-panel:not([hidden])");
    await page.waitForFunction(() => document.querySelector("input[name=address]").value.length > 0, { timeout: 15000 });
    const address = await page.$eval("input[name=address]", (i) => i.value);
    await page.type("input[name=title]", "Test-Restaurant");
    // erst ohne Kategorie speichern -> Fehlermeldung
    await page.click("#btn-save");
    const err = await page.$eval("#form-error", (e) => e.textContent);
    await page.evaluate(() => document.querySelector("input[name=category][value=restaurant]").closest("label").click());
    await page.type("input[name=author]", "CI");
    await page.type("textarea[name=description]", "Gutes Essen.");
    const errHiddenAfterFix = await page.$eval("#form-error", (e) => e.hidden);
    await sleep(400);
    await page.screenshot({ path: `${OUT}/02-desktop-form.png` });
    await page.click("#btn-save");
    await page.waitForSelector(".leaflet-popup .poi-popup", { timeout: 5000 });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/03-desktop-popup.png` });
    return { address, err, errHiddenAfterFix, pins: await visiblePins(page) };
  });

  await step("edit POI category", async () => {
    await clickText(page, ".poi-popup button", "Bearbeiten");
    await page.waitForSelector("#poi-panel:not([hidden])");
    const before = await page.$eval("input[name=category]:checked", (i) => i.value);
    await page.evaluate(() => document.querySelector("input[name=category][value=cafe]").closest("label").click());
    await page.click("#btn-save");
    await page.waitForFunction(() => {
      const b = document.querySelector(".leaflet-popup .cat-badge");
      return b && b.textContent.includes("Café");
    }, { timeout: 5000 });
    const badge = await page.$eval(".leaflet-popup .cat-badge", (e) => e.textContent);
    const res = await (await fetch(BASE + "api/pois")).json();
    return { before, badge, categories: res.map((p) => p.title + ":" + p.category) };
  });

  await step("filter", async () => {
    await page.click("#btn-filter");
    await page.waitForSelector("#filter-panel:not([hidden])");
    const before = await visiblePins(page);
    await page.evaluate(() => document.querySelector("#filter-list input[value=cafe]").click());
    await sleep(300);
    const after = await visiblePins(page);
    await page.screenshot({ path: `${OUT}/04-desktop-filter.png` });
    const dot = await page.$eval("#filter-dot", (d) => !d.hidden);
    await clickText(page, "#filter-panel button", "Alle");
    const all = await visiblePins(page);
    await clickText(page, "#filter-panel button", "Keine");
    const none = await visiblePins(page);
    await clickText(page, "#filter-panel button", "Alle");
    await page.keyboard.press("Escape");
    const closed = await page.$eval("#filter-panel", (p) => p.hidden);
    return { before, after, dot, all, none, closed };
  });

  await step("list sidebar", async () => {
    await page.click("#btn-list");
    await page.waitForSelector("#list-panel.is-open");
    await sleep(400);
    const items = await page.$$eval(".poi-item .title", (n) => n.map((x) => x.textContent));
    const ctrlShift = await page.$eval(".leaflet-left", (e) => getComputedStyle(e).transform);
    await page.screenshot({ path: `${OUT}/09-desktop-list.png` });
    await page.evaluate(() => [...document.querySelectorAll(".poi-item")].find((b) => b.textContent.includes("Irgendwas")).click());
    await page.waitForFunction(() => {
      const h = document.querySelector(".leaflet-popup h3");
      return h && h.textContent === "Irgendwas";
    }, { timeout: 5000 });
    await sleep(500);
    const active = await page.$$eval(".poi-item.is-active .title", (n) => n.map((x) => x.textContent));
    await page.screenshot({ path: `${OUT}/10-desktop-list-jump.png` });
    await page.click("#list-close");
    await sleep(300);
    const closed = await page.$eval("#list-panel", (p) => !p.classList.contains("is-open"));
    return { items, ctrlShift, active, closed };
  });

  await step("search my places", async () => {
    await page.click("#search-input");
    await page.type("#search-input", "cafe");
    await page.waitForSelector("#search-results:not([hidden])");
    const mine = await page.$$eval("#search-results .search-section:first-child .search-option .title", (n) => n.map((x) => x.textContent));
    const action = await page.$$eval("#search-results .search-option.is-action .title", (n) => n.map((x) => x.textContent));
    await page.screenshot({ path: `${OUT}/11-desktop-search-mine.png` });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const h = document.querySelector(".leaflet-popup h3");
      return h && /Caf/.test(h.textContent);
    }, { timeout: 5000 });
    const popup = await page.$eval(".leaflet-popup h3", (h) => h.textContent);
    const resultsHidden = await page.$eval("#search-results", (r) => r.hidden);
    return { mine, action, popup, resultsHidden };
  });

  await step("search addresses", async () => {
    await page.evaluate(() => { const i = document.querySelector("#search-input"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("#search-input");
    await page.type("#search-input", "Kaiserstraße 12");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const s = document.querySelectorAll("#search-results .search-section")[1];
      return s && (s.querySelector(".search-option:not(.is-action)") || /Keine|nicht/.test(s.textContent));
    }, { timeout: 15000 });
    const addresses = await page.$$eval("#search-results .search-section:nth-child(2) .search-option", (n) => n.map((x) => x.textContent));
    await page.screenshot({ path: `${OUT}/12-desktop-search-addresses.png` });
    await page.evaluate(() => document.querySelectorAll("#search-results .search-section")[1].querySelector(".search-option").click());
    await page.waitForSelector(".leaflet-marker-pane .search-pin");
    await page.waitForFunction(() => /Suchergebnis/.test((document.querySelector(".leaflet-popup") || {}).textContent || ""), { timeout: 5000 });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/13-desktop-address-popup.png` });
    await clickText(page, ".poi-popup button", "Als POI anlegen");
    await page.waitForSelector("#poi-panel:not([hidden])");
    const prefill = await page.evaluate(() => ({ title: document.querySelector("input[name=title]").value, address: document.querySelector("input[name=address]").value }));
    const searchPinGone = await page.$$eval(".search-pin", (n) => n.length === 0);
    await page.click("#poi-panel [data-action=close]");
    await page.evaluate(() => { const i = document.querySelector("#search-input"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("#search-input");
    await page.keyboard.press("Escape");
    return { addresses, prefill, searchPinGone };
  });

  await step("route", async () => {
    await openViaList(page, "Café Bleu");
    await page.screenshot({ path: `${OUT}/19-desktop-popup-route-btn.png` });
    await page.click(".leaflet-popup .route-btn");
    await page.waitForSelector("#route-panel:not([hidden])");
    const summary = async () => {
      await page.waitForSelector("#route-summary .figures, #route-summary.is-error", { timeout: 20000 });
      return page.$eval("#route-summary", (e) => e.textContent);
    };
    const foot = await summary();
    const lines = await page.$$eval(".leaflet-overlay-pane path", (n) => n.length);
    await sleep(800);
    await page.screenshot({ path: `${OUT}/20-desktop-route-foot.png` });
    await page.click('.mode-btn[data-mode="bike"]');
    await page.waitForFunction((t) => document.querySelector("#route-summary").textContent !== t, {}, foot);
    const bike = await summary();
    await page.click('.mode-btn[data-mode="car"]');
    await page.waitForFunction((t) => document.querySelector("#route-summary").textContent !== t, {}, bike);
    const car = await summary();
    await sleep(800);
    await page.screenshot({ path: `${OUT}/21-desktop-route-car.png` });
    await page.click("#route-close");
    await sleep(300);
    const hidden = await page.$eval("#route-panel", (p) => p.hidden);
    const linesAfter = await page.$$eval(".leaflet-overlay-pane path", (n) => n.length);
    return { foot, bike, car, lines, hidden, linesAfter };
  });

  await step("route denied location", async () => {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    await p.setViewport({ width: 1280, height: 800 });
    await p.goto(BASE, { waitUntil: "networkidle0" });
    await p.waitForSelector(".leaflet-marker-pane .poi-pin");
    await p.click(".leaflet-marker-pane .poi-pin");
    await p.waitForSelector(".leaflet-popup .route-btn");
    await p.click(".leaflet-popup .route-btn");
    await p.waitForSelector("#route-summary.is-error", { timeout: 20000 });
    const text = await p.$eval("#route-summary", (e) => e.textContent);
    await p.screenshot({ path: `${OUT}/22-desktop-route-denied.png` });
    await ctx.close();
    return text;
  });

  await step("delete POI with confirmation", async () => {
    await sleep(500);
    const before = await visiblePins(page);
    const titles = await page.$$eval(".leaflet-marker-pane .poi-pin:not(.is-draft)", (n) => n.map((x) => x.title));
    await openViaList(page, "Café Bleu");
    await page.click("#list-close");
    await sleep(400);
    const popupsAfterOpen = await page.$$eval(".leaflet-popup h3", (n) => n.map((x) => x.textContent));
    await page.screenshot({ path: `${OUT}/05a-desktop-popup-open.png` });
    await clickText(page, ".poi-popup button", "Löschen");
    await sleep(300);
    await clickText(page, ".poi-popup button", "Abbrechen");
    await sleep(300);
    const afterCancel = await page.$$eval(".leaflet-popup .actions:not([hidden]) button", (n) => n.map((x) => x.textContent));
    await clickText(page, ".poi-popup .actions:not([hidden]) button", "Löschen");
    await sleep(400);
    const popupsAfterAsk = await page.$$eval(".leaflet-popup .confirm:not([hidden])", (n) => n.map((x) => x.textContent));
    await page.screenshot({ path: `${OUT}/05-desktop-delete-confirm.png` });
    await clickText(page, ".poi-popup button", "Ja, löschen");
    await sleep(800);
    const res = await (await fetch(BASE + "api/pois")).json();
    return { titles, popupsAfterOpen, afterCancel, popupsAfterAsk, before, after: await visiblePins(page), server: res.length };
  });

  await step("mobile", async () => {
    const m = await browser.newPage();
    m.on("pageerror", (e) => consoleErrors.push("mobile pageerror: " + e.message));
    await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await m.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
    await m.goto(BASE, { waitUntil: "networkidle0" });
    await sleep(1500);
    await m.screenshot({ path: `${OUT}/06-mobile-map.png` });
    await m.tap("#btn-new-poi");
    await m.tap("#map");
    await m.waitForSelector("#poi-panel:not([hidden])");
    await m.evaluate(() => document.querySelector("input[name=category][value=park]").closest("label").click());
    await sleep(2500);
    await m.screenshot({ path: `${OUT}/07-mobile-form.png` });
    await m.tap("#poi-panel [data-action=close]");
    await m.tap("#btn-filter");
    await sleep(300);
    await m.screenshot({ path: `${OUT}/08-mobile-filter.png` });
    await m.tap("#btn-filter");
    await m.tap("#btn-search");
    await m.waitForSelector(".search-open #search-input");
    await m.type("#search-input", "irgend");
    await m.waitForSelector("#search-results:not([hidden])");
    await sleep(300);
    await m.screenshot({ path: `${OUT}/14-mobile-search.png` });
    await m.tap("#search-results .search-option");
    await m.waitForFunction(() => /Irgendwas/.test((document.querySelector(".leaflet-popup h3") || {}).textContent || ""), { timeout: 5000 });
    const searchClosed = await m.evaluate(() => !document.body.classList.contains("search-open"));
    await sleep(400);
    await m.screenshot({ path: `${OUT}/15-mobile-search-jump.png` });
    await m.tap("#btn-list");
    await m.waitForSelector("#list-panel.is-open");
    await sleep(400);
    await m.screenshot({ path: `${OUT}/16-mobile-list.png` });
    await m.tap(".poi-item");
    await sleep(1200);
    const listClosedAfterTap = await m.evaluate(() => !document.querySelector("#list-panel").classList.contains("is-open"));
    const popupAfterTap = await m.evaluate(() => (document.querySelector(".leaflet-popup h3") || {}).textContent);
    await m.screenshot({ path: `${OUT}/17-mobile-list-jump.png` });
    await m.setGeolocation({ latitude: 48.9935, longitude: 8.4012 });
    await m.tap(".leaflet-popup .route-btn");
    await m.waitForSelector("#route-summary .figures, #route-summary.is-error", { timeout: 20000 });
    await sleep(1000);
    const mobileRoute = await m.$eval("#route-summary", (e) => e.textContent);
    await m.screenshot({ path: `${OUT}/23-mobile-route.png` });
    const nav = await m.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, navH: document.querySelector(".navbar").offsetHeight }));
    const t = await browser.newPage();
    await t.setViewport({ width: 820, height: 600 });
    await t.goto(BASE, { waitUntil: "networkidle0" });
    await t.screenshot({ path: `${OUT}/18-tablet-navbar.png`, clip: { x: 0, y: 0, width: 820, height: 120 } });
    const tabletScroll = await t.evaluate(() => document.documentElement.scrollWidth);
    return { ...nav, searchClosed, listClosedAfterTap, popupAfterTap, tabletScroll, mobileRoute };
  });

  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, consoleErrors }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ results, consoleErrors }, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
