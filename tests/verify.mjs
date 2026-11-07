// 引継書 §13「ローカル確認」チェックリストの自動検証。
// 実ブラウザ（Playwright Chromium, headless）で wrangler dev を叩く。
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

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
  window.__copied = [];
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (text) => { window.__copied.push(text); } },
  });
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
await page.locator("#rounds button:has-text('天鳳で開く')").first().click();
let urls = await page.evaluate(() => window.__openedUrls);
const urlNoTw = urls.at(-1);
record("10. 天鳳 URL に #json= が入る", urlNoTw.includes("#json="), urlNoTw.slice(0, 60) + "…");
record("10b. 視点なしのとき ?tw= が入らない", !urlNoTw.includes("?tw="), "");
record("11. 「天鳳で開く」が動く", urlNoTw.startsWith("https://tenhou.net/5/"), "");

// 視点=北家(3) のときの URL
await viewpoint.selectOption("3");
await page.locator("#rounds button:has-text('天鳳で開く')").first().click();
urls = await page.evaluate(() => window.__openedUrls);
const urlTw = urls.at(-1);
record("9. 視点指定 URL に ?tw=N が入る", urlTw.includes("?tw=3") && urlTw.includes("#json="), urlTw.slice(0, 48) + "…");

// URL の JSON が復元可能か
const decoded = JSON.parse(decodeURIComponent(urlTw.split("#json=")[1]));
record("9b. URL 内の JSON が復元できる", Array.isArray(decoded.log) && decoded.log.length === 1, `log 長=${decoded.log?.length}`);

// --- 補完の検証: 短縮和了が天鳳形式へ展開されているか ---
await viewpoint.selectOption("");
await page.locator("#rounds button:has-text('天鳳で開く')").first().click();
urls = await page.evaluate(() => window.__openedUrls);
const round1 = JSON.parse(decodeURIComponent(urls.at(-1).split("#json=")[1])).log[0];
const agari = round1[16];
record(
  "補完A. 短縮和了が天鳳の和了詳細へ展開される",
  Array.isArray(agari) && agari[0] === "和了" && Array.isArray(agari[2]) && agari[2].length > 2,
  `detail 長=${agari?.[2]?.length}`
);
record("補完B. 元の点差が保持される", JSON.stringify(agari[1]) === JSON.stringify([-3900, 0, 3900, 0]), JSON.stringify(agari[1]));

// --- 全局の通し再生: 局単位と同じ補完結果を 1 つの log にまとめる ---
const roundCount = JSON.parse(FIXTURE).log.length;
const roundLogs = [];
for (let i = 0; i < roundCount; i++) {
  await page.locator("#rounds button:has-text('天鳳で開く')").nth(i).click();
  const url = (await page.evaluate(() => window.__openedUrls)).at(-1);
  roundLogs.push(JSON.parse(decodeURIComponent(url.split("#json=")[1])).log[0]);
}
await viewpoint.selectOption("3");
await page.locator("#gameSummary button:has-text('全局を天鳳で開く')").click();
const gameUrl = (await page.evaluate(() => window.__openedUrls)).at(-1);
const gameData = JSON.parse(decodeURIComponent(gameUrl.split("#json=")[1]));
record("全局A. 全局の URL に全局が入る", gameData.log?.length === roundCount, `log 長=${gameData.log?.length} / 局数=${roundCount}`);
record("全局B. 各局が局単位の補完結果と一致する", JSON.stringify(gameData.log) === JSON.stringify(roundLogs));
record("全局C. 全局の URL にも視点指定が入る", gameUrl.startsWith("https://tenhou.net/5/?tw=3#json="), gameUrl.slice(0, 48) + "…");

await page.locator("#gameSummary .more-menu summary").click();
await page.locator("#gameSummary button:has-text('全局の再生URLをコピー')").click();
// コピー後にメニューが自動で閉じるのを待ってから開き直す
await page.waitForSelector("#gameSummary .more-menu:not([open])", { state: "attached" });
await page.locator("#gameSummary .more-menu summary").click();
await page.locator("#gameSummary button:has-text('全局の補完後JSONをコピー')").click();
const copied = await page.evaluate(() => window.__copied);
record("全局D. 全局の再生 URL をまとめてコピーできる", copied.at(-2) === gameUrl);
record("全局E. 全局の補完後 JSON をまとめてコピーできる", copied.at(-1) === JSON.stringify(gameData));

// --- NAGA カスタム解析: 1 行 1 局の天鳳牌譜エディタ URL をコピーして NAGA を開く ---
await page.locator("#gameSummary button:has-text('NAGAで解析')").click();
const nagaText = (await page.evaluate(() => window.__copied)).at(-1);
const nagaLines = nagaText.split("\n");
const NAGA_PREFIX = "https://tenhou.net/6/#json=";
record("NAGA-A. 1 行 1 局でコピーされる", nagaLines.length === roundCount, `行数=${nagaLines.length} / 局数=${roundCount}`);
record("NAGA-B. 各行が天鳳牌譜エディタ形式の URL", nagaLines.every((l) => l.startsWith(NAGA_PREFIX)));
const nagaLogs = nagaLines.map((l) => JSON.parse(l.slice(NAGA_PREFIX.length)));
record(
  "NAGA-C. 各行が局単位の補完結果と一致する",
  nagaLogs.every((d, i) => d.log.length === 1 && JSON.stringify(d.log[0]) === JSON.stringify(roundLogs[i]))
);
record(
  "NAGA-D. NAGA のカスタム解析画面が開く",
  (await page.evaluate(() => window.__openedUrls)).at(-1) === "https://naga.dmv.nico/naga_report/order_form/?show_tab=1"
);
record(
  "NAGA-E. コピー完了が表示される",
  (await page.locator("#gameSummary .summary-status").innerText()).includes(`${roundCount}局分をコピーしました`)
);

await viewpoint.selectOption("");

// --- 役名が天鳳の正式表記に揃っている（NAGA は未知の役名を拒否する） ---
// 天鳳牌譜エディタ（cdn.tenhou.net/6/）が持つ役名一覧。ドラ類は飜数が可変のため別判定。
const TENHOU_YAKU = new Set([
  "門前清自摸和(1飜)", "立直(1飜)", "一発(1飜)", "槍槓(1飜)", "嶺上開花(1飜)", "海底摸月(1飜)", "河底撈魚(1飜)",
  "平和(1飜)", "断幺九(1飜)", "一盃口(1飜)",
  "自風 東(1飜)", "自風 南(1飜)", "自風 西(1飜)", "自風 北(1飜)",
  "場風 東(1飜)", "場風 南(1飜)", "場風 西(1飜)", "場風 北(1飜)",
  "役牌 白(1飜)", "役牌 發(1飜)", "役牌 中(1飜)",
  "両立直(2飜)", "七対子(1飜)", "七対子(2飜)", "混全帯幺九(1飜)", "混全帯幺九(2飜)",
  "一気通貫(1飜)", "一気通貫(2飜)", "三色同順(1飜)", "三色同順(2飜)", "三色同刻(2飜)", "三槓子(2飜)",
  "対々和(2飜)", "三暗刻(2飜)", "小三元(2飜)", "混老頭(2飜)", "二盃口(3飜)",
  "純全帯幺九(2飜)", "純全帯幺九(3飜)", "混一色(2飜)", "混一色(3飜)", "清一色(5飜)", "清一色(6飜)",
  "天和(役満)", "地和(役満)", "大三元(役満)", "四暗刻(役満)", "四暗刻単騎(役満)", "字一色(役満)",
  "緑一色(役満)", "清老頭(役満)", "九蓮宝燈(役満)", "純正九蓮宝燈(役満)", "国士無双(役満)",
  "国士無双１３面(役満)", "大四喜(役満)", "小四喜(役満)", "四槓子(役満)",
]);
const isTenhouYaku = (y) => TENHOU_YAKU.has(y) || /^(ドラ|裏ドラ|赤ドラ)\(\d+飜\)$/.test(y);
const unknownYaku = [];
for (const file of ["../public/sample.json", ...readdirSync("fixtures").map((f) => `fixtures/${f}`)]) {
  await page.click("#clearBtn");
  await page.fill("#jsonInput", readFileSync(file, "utf8"));
  await page.click("#parseBtn");
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });
  await page.locator("#gameSummary button:has-text('NAGAで解析')").click();
  const lines = (await page.evaluate(() => window.__copied)).at(-1).split("\n");
  for (const line of lines) {
    const result = JSON.parse(line.slice(NAGA_PREFIX.length)).log[0][16];
    if (result?.[0] !== "和了") continue;
    for (let i = 2; i < result.length; i += 2) {
      for (const y of result[i].slice(4)) if (!isTenhouYaku(y)) unknownYaku.push(`${file}: ${y}`);
    }
  }
}
record("役名. 全牌譜の役名が天鳳の正式表記", unknownYaku.length === 0, unknownYaku.join(" / ") || "未知の役名なし");
await page.click("#clearBtn");
await page.fill("#jsonInput", FIXTURE);
await page.click("#parseBtn");
await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 5000 });

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
