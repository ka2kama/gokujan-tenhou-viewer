// 汎用化検証: 条件付き補完 + 喰いタンデフォルト ON
// A: ルール情報なしの鳴きタンヤオ → 断幺九が計上され点数一致
// B: 役リスト完備の detail → 元データを素通し（上書き・補完バッジなし）
// C: 得点のみの detail → 役補完が機能（回帰ガード）
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787/";
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
await page.goto(BASE, { waitUntil: "domcontentloaded" });

async function load(fixturePath) {
  await page.click("#clearBtn");
  await page.fill("#jsonInput", readFileSync(fixturePath, "utf8"));
  await page.click("#parseBtn");
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
  const card = page.locator("#rounds article.round").first();
  return {
    card,
    text: (await card.innerText()).replace(/\n/g, " "),
    hasBadge: (await card.locator(".patch-badge").count()) > 0,
  };
}

const MISMATCH = "役計算と点差が一致しない";

// --- A: 喰いタンデフォルト ---
{
  const { text, hasBadge } = await load("fixtures/open-tanyao-no-rule.json");
  record("A1. ルール情報なしで断幺九が計上される", text.includes("断幺九"), text.slice(0, 120));
  record("A2. 点数一致（不一致警告なし）", !text.includes(MISMATCH) && text.includes("30符1飜1000点"));
  record("A3. 補完バッジあり", hasBadge);
}

// --- B: 完備 detail の素通し ---
{
  const { card, text, hasBadge } = await load("fixtures/complete-detail.json");
  record("B1. 元の役表記がそのまま表示される", text.includes("役牌 中(1飜)") && text.includes("赤ドラ(1飜)"), text.slice(0, 120));
  record("B2. 補完バッジなし", !hasBadge);
  record("B3. 不一致警告なし", !text.includes(MISMATCH));
  await card.locator("button:has-text('天鳳で開く')").click();
  const url = (await page.evaluate(() => window.__opened)).at(-1);
  const detail = JSON.parse(decodeURIComponent(url.split("#json=")[1])).log[0][16][2];
  record(
    "B4. ビューア JSON の detail が元データと完全一致",
    JSON.stringify(detail) === JSON.stringify([2, 1, 2, "40符2飜2600点", "役牌 中(1飜)", "赤ドラ(1飜)"]),
    JSON.stringify(detail)
  );
}

// --- C: 部分 detail の補完（回帰） ---
{
  const { text, hasBadge } = await load("fixtures/mleague-partial.json");
  record("C1. 役なし detail に役が補完される", text.includes("中(1飜)") && text.includes("赤ドラ(1飜)"), text.slice(0, 120));
  record("C2. 得点表記が保持される", text.includes("40符2飜2600点"));
  record("C3. 補完バッジあり", hasBadge);
}

// --- 四麻限定の明記（UI） ---
{
  const body = await page.locator("body").innerText();
  record("D1. 四人麻雀限定の明記が UI に存在する", /三人麻雀には対応していません/.test(body));
}

record("E1. コンソールエラーなし", consoleErrors.length === 0, consoleErrors.join(" / ") || "");
await browser.close();

const fail = results.filter((r) => !r.ok).length;
console.log(`\n===== ${results.length - fail}/${results.length} PASS =====`);
process.exit(fail ? 1 : 0);
