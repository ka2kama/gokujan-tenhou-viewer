// 引継書 §13「ローカル確認」チェックリストの自動検証。
// 実ブラウザ（Playwright Chromium, headless）で wrangler dev を叩く。
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787/";
const FIXTURE = readFileSync("fixtures/basic.json", "utf8");

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// window.open を差し替え、天鳳への実アクセスを避けつつ URL を捕捉する。
await context.addInitScript(() => {
  window.__openedUrls = [];
  window.open = (url) => { window.__openedUrls.push(url); return null; };
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

// --- 1. ページが表示される ---
const resp = await page.goto(BASE, { waitUntil: "domcontentloaded" });
record("1. ページが表示される", resp.status() === 200, `HTTP ${resp.status()}, title="${await page.title()}"`);

const h1 = await page.locator("h1").first().textContent();
record("1b. タイトル文言が固定仕様どおり", h1.trim() === "極雀 → 天鳳牌譜ビューア", `h1="${h1.trim()}"`);

const heroLines = (await page.locator(".hero-copy .copy-line").allTextContents()).map((s) => s.trim());
record(
  "1c. リード文が固定仕様どおり",
  heroLines[0] === "極雀（旧 BigCoach）のAI対戦牌譜を、天鳳の牌譜ビューアで再生します。" &&
    heroLines[1] === "不足している和了情報は、対局内容から判定できる範囲で補完します。",
  heroLines.join(" / ")
);

// --- 4. 不正 JSON で生の parser error が出ない ---
await page.fill("#jsonInput", "{ これは壊れた JSON");
await page.click("#parseBtn");
await page.waitForSelector("#status.error", { timeout: 5000 });
const errText = (await page.textContent("#status")).trim();
const leaksRawParserError = /Unexpected token|JSON\.parse|SyntaxError|position \d+|in JSON at/i.test(errText);
record("4. 不正 JSON で生の parser error が出ない", !leaksRawParserError, `表示="${errText}"`);
record("4b. 不正 JSON 時に局一覧が出ない", await page.locator("#resultPanel").isHidden());

// 空入力
await page.fill("#jsonInput", "");
await page.click("#parseBtn");
const emptyMsg = (await page.textContent("#status")).trim();
record("4c. 空入力に専用メッセージ", emptyMsg === "牌譜JSONを貼り付けてください。", `表示="${emptyMsg}"`);

// --- 2 / 5 / 12. 貼り付け + Ctrl+Enter で読み込める ---
await page.fill("#jsonInput", FIXTURE);
await page.locator("#jsonInput").press("Control+Enter");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
const okStatus = (await page.textContent("#status")).trim();
record("2/5. 貼り付け + Ctrl+Enter で読み込める", okStatus.includes("3局を読み込みました"), `表示="${okStatus}"`);

// --- 6. 局一覧が表示される ---
const cards = page.locator("#rounds .round-card, #rounds > *");
const cardCount = await cards.count();
record("6. 局一覧が表示される", cardCount === 3, `カード数=${cardCount}`);

const listText = await page.locator("#rounds").innerText();
record("6b. 局名が表示される", listText.includes("東1局") && listText.includes("東2局"), "東1局 / 東2局 を検出");
record("6c. 本場が表示される", /1本場/.test(listText), "1本場 を検出");

// --- 7. 和了者が表示される ---
record("7. 和了者が表示される", listText.includes("玩家"), "和了者名「玩家」を検出");
record("7b. ツモ / ロンが表示される", listText.includes("ロン") && listText.includes("ツモ"), "ロン / ツモ を検出");
record("7c. 役が表示される", /一気通貫|三色同順|立直/.test(listText), "役名を検出");

// --- 13. 通常流局に重複文言が出ない ---
record("13. 通常流局に「通常の流局」が出ない", !listText.includes("通常の流局"), "文字列不在を確認");
record("13b. 流局が表示される", listText.includes("流局"), "流局 を検出");

// --- 8 / 10. 再生視点と URL ---
const viewpoint = page.locator("select").first();
record("8. 再生視点セレクトが存在する", (await viewpoint.count()) === 1);
const options = await viewpoint.locator("option").allTextContents();
record(
  "8b. 視点の選択肢が仕様どおり",
  ["指定しない", "東家", "南家", "西家", "北家"].every((l) => options.some((o) => o.includes(l))),
  options.map((o) => o.trim()).join(" | ")
);
const initialViewpoint = await viewpoint.inputValue();
record("8c. 「玩家」が初期選択される", initialViewpoint === "2", `value=${initialViewpoint}`);

// 視点=指定しない のときの URL
await viewpoint.selectOption("");
await page.locator("button:has-text('天鳳で開く')").first().click();
let urls = await page.evaluate(() => window.__openedUrls);
const urlNoTw = urls.at(-1);
record("10. 天鳳 URL に #json= が入る", urlNoTw.includes("#json="), urlNoTw.slice(0, 60) + "…");
record("10b. 視点なしのとき ?tw= が入らない", !urlNoTw.includes("?tw="), "");
record("11. 「天鳳で開く」が動く", urlNoTw.startsWith("https://tenhou.net/5/"), "");

// 視点=北家(3) のときの URL
await viewpoint.selectOption("3");
await page.locator("button:has-text('天鳳で開く')").first().click();
urls = await page.evaluate(() => window.__openedUrls);
const urlTw = urls.at(-1);
record("9. 視点指定 URL に ?tw=N が入る", urlTw.includes("?tw=3") && urlTw.includes("#json="), urlTw.slice(0, 48) + "…");

// URL の JSON が復元可能か
const decoded = JSON.parse(decodeURIComponent(urlTw.split("#json=")[1]));
record("9b. URL 内の JSON が復元できる", Array.isArray(decoded.log) && decoded.log.length === 1, `log 長=${decoded.log?.length}`);

// --- 補完の検証: 短縮和了が天鳳形式へ展開されているか ---
await viewpoint.selectOption("");
await page.locator("button:has-text('天鳳で開く')").first().click();
urls = await page.evaluate(() => window.__openedUrls);
const round1 = JSON.parse(decodeURIComponent(urls.at(-1).split("#json=")[1])).log[0];
const agari = round1[16];
record(
  "補完A. 短縮和了が天鳳の和了詳細へ展開される",
  Array.isArray(agari) && agari[0] === "和了" && Array.isArray(agari[2]) && agari[2].length > 2,
  `detail 長=${agari?.[2]?.length}`
);
record("補完B. 元の点差が保持される", JSON.stringify(agari[1]) === JSON.stringify([-3900, 0, 3900, 0]), JSON.stringify(agari[1]));

// --- 引継書 §7「元点差との不一致」の 2 経路 ---
const MISMATCH_NOTE = "役計算と点差が一致しないため";
record(
  "§7-a. 点差が一致するとき不一致の注記が出ない",
  !(await page.locator("#rounds").innerText()).includes(MISMATCH_NOTE),
  "注記なしを確認"
);

// 意図的に点差をずらして注記が出ることを確認する
const skewed = JSON.parse(FIXTURE);
skewed.log[0][16] = ["和了", [-12000, 0, 12000, 0], [2, 0]];
await page.click("#clearBtn");
await page.fill("#jsonInput", JSON.stringify(skewed));
await page.click("#parseBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
const skewedText = await page.locator("#rounds").innerText();
record("§7-b. 点差が食い違うとき不一致が明示される", skewedText.includes(MISMATCH_NOTE), "注記ありを確認");
record("§7-c. 元データの点差が表示に使われる", /12000点/.test(skewedText), "12000点 を検出");

await page.click("#clearBtn");
await page.fill("#jsonInput", FIXTURE);
await page.click("#parseBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });

// --- 3. ファイルから読み込める ---
await page.click("#clearBtn");
writeFileSync("output/upload.json", FIXTURE);
await page.setInputFiles("#fileInput", "output/upload.json");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
record("3. JSON ファイルを読み込める", (await page.locator("#rounds").innerText()).includes("東1局"));

// --- 12. クリアが動く ---
await page.click("#clearBtn");
const clearedValue = await page.inputValue("#jsonInput");
const panelHidden = await page.locator("#resultPanel").isHidden();
record("12. クリアが動く", clearedValue === "" && panelHidden, `textarea 空=${clearedValue === ""}, 局一覧非表示=${panelHidden}`);

// --- 14. モバイル表示が破綻しない ---
await page.setViewportSize({ width: 375, height: 812 });
await page.fill("#jsonInput", FIXTURE);
await page.click("#parseBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
const overflow = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
record(
  "14. モバイル(375px)で横スクロールが発生しない",
  overflow.scrollW <= overflow.clientW + 1,
  `scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}`
);
await page.screenshot({ path: "output/mobile.png", fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 });
await page.screenshot({ path: "output/desktop.png", fullPage: true });

// --- コンソールエラー ---
record("15. コンソールエラーが発生しない", consoleErrors.length === 0, consoleErrors.join(" / ") || "エラーなし");

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length) {
  console.log("FAILED:");
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
}
process.exit(failed.length ? 1 : 0);
