// 局一覧の和了者ラベルが「対局開始時の席」で固定表示されることの検証。
// 実データ（fixture-real.json）: name = [AI, AI, 玩家, AI] → 東/南/西/北。
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787/";
const FIXTURE = readFileSync("fixtures/gokujan-11rounds.json", "utf8");

// [局タイトル, 期待する和了者ラベル（開始時席）, ツモ/ロン] — 流局の局は winner なし
const EXPECTED = [
  ["東1局",        "AI ③", "ツモ"],
  ["東2局",        null,         null],   // 流局
  ["東3局 1本場",  "玩家", "ロン"],
  ["東3局 2本場",  "AI ③", "ロン"],
  ["東4局",        "AI ①", "ロン"],
  ["南1局",        "AI ①", "ロン"],
  ["南1局 1本場",  "AI ③", "ロン"],
  ["南2局",        "AI ②", "ツモ"],
  ["南2局 1本場",  "玩家", "ツモ"],
  ["南3局",        "AI ②", "ロン"],
  ["南4局",        "AI ③", "ロン"],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill("#jsonInput", FIXTURE);
await page.click("#parseBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });

const cards = await page.locator("#rounds article.round").all();
console.log(`局カード数: ${cards.length}（期待 ${EXPECTED.length}）\n`);

let fail = 0;
for (let i = 0; i < EXPECTED.length; i++) {
  const [title, winnerLabel, method] = EXPECTED[i];
  const card = cards[i];
  const actualTitle = (await card.locator(".round-title > span").first().textContent()).trim();
  const winnerEl = card.locator(".winner-summary strong");
  const hasWinner = (await winnerEl.count()) > 0;
  const actualWinner = hasWinner ? (await winnerEl.first().textContent()).trim() : null;
  const actualMethod = hasWinner ? (await card.locator(".win-method").first().textContent()).trim() : null;

  const okTitle = actualTitle === title;
  const okWinner = actualWinner === winnerLabel && actualMethod === method;
  const ok = okTitle && okWinner;
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${title.padEnd(10)} 期待=${winnerLabel ?? "（流局）"}${method ?? ""}  実際=${actualWinner ?? "（表示なし）"}${actualMethod ?? ""}` +
    (okTitle ? "" : `  ※タイトル不一致: ${actualTitle}`)
  );
}

if (consoleErrors.length) { fail++; console.log(`\nコンソールエラー: ${consoleErrors.join(" / ")}`); }
await browser.close();
console.log(`\n===== ${EXPECTED.length - fail >= 0 ? EXPECTED.length - fail : 0}/${EXPECTED.length} PASS =====`);
process.exit(fail ? 1 : 0);
