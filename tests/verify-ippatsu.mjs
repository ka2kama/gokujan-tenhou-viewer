// イベントシーケンサ検証: 鳴きでローカル index が巡目とずれた牌譜でも
// 一発・両立直の順序判定が正しく行われること。
// 実対局の証言（南3局: 東家の暗槓 → 西家の立直 → 北家から即ロン = 一発）に基づく。
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
page.on("pageerror", (e) => consoleErrors.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// --- 14 局の実データ（南3局に鳴きズレ + 二軒立直 + 立直後暗槓） ---
await page.fill("#jsonInput", readFileSync("fixtures/gokujan-14rounds-ippatsu.json", "utf8"));
await page.click("#parseBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });

const text = await page.locator("#rounds").innerText();
const warns = (text.match(/役計算と点差が一致しない/g) || []).length;
const fails = (text.match(/補完できませんでした/g) || []).length;
record("1. 全 14 局で点差不一致警告ゼロ", warns === 0, `警告 ${warns} 件`);
record("2. 補完失敗ゼロ", fails === 0, `失敗 ${fails} 件`);

const cards = await page.locator("#rounds article.round").all();
let minami3 = null;
for (const card of cards) {
  const t = await card.innerText();
  if (t.includes("南3局")) minami3 = t.replace(/\n/g, " ");
}
record("3. 南3局に一発が計上される", minami3?.includes("一発"), minami3?.slice(0, 140));
record("4. 南3局が満貫 8000 点", /満貫8000点/.test(minami3 ?? ""), "");

// --- 回帰: 既存サンプル 12 局は引き続き警告ゼロ ---
await page.click("#clearBtn");
await page.click("#sampleBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 8000 });
const sampleText = await page.locator("#rounds").innerText();
const sampleWarns = (sampleText.match(/役計算と点差が一致しない/g) || []).length;
record("5. サンプル牌譜も警告ゼロを維持", sampleWarns === 0, `警告 ${sampleWarns} 件`);

record("6. コンソールエラーなし", consoleErrors.length === 0, consoleErrors.join(" / ") || "");
await browser.close();

const fail = results.filter((r) => !r.ok).length;
console.log(`\n===== ${results.length - fail}/${results.length} PASS =====`);
process.exit(fail ? 1 : 0);
