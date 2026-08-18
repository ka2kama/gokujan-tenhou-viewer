// 全スイートの一括実行ランナー。
// BASE 未指定なら wrangler dev をテスト専用ポートで起動してローカル検証し、
// BASE 指定時（例: 公開サイト）はそのまま対象 URL に対して実行する。
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DIR = import.meta.dirname;
const SUITES = ["verify.mjs", "verify-seats.mjs", "verify-generic.mjs", "verify-ippatsu.mjs"];
mkdirSync(path.join(DIR, "output"), { recursive: true });

let server = null;
let base = process.env.BASE;
if (!base) {
  base = "http://127.0.0.1:8788/";
  server = spawn("npx", ["wrangler", "dev", "--port", "8788"], {
    cwd: path.join(DIR, ".."),
    stdio: "ignore",
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  const deadline = Date.now() + 60_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) { up = true; break; }
    } catch { /* 起動待ち */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) {
    stopServer();
    console.error("dev サーバーが起動しませんでした");
    process.exit(1);
  }
}

function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); }
}

let failed = 0;
for (const suite of SUITES) {
  console.log(`\n===== ${suite} =====`);
  const r = spawnSync(process.execPath, [path.join(DIR, suite)], {
    cwd: DIR,
    stdio: "inherit",
    env: { ...process.env, BASE: base },
  });
  if (r.status !== 0) failed++;
}
stopServer();
console.log(failed ? `\n${failed} スイート失敗` : "\n全スイート成功");
process.exit(failed ? 1 : 0);
