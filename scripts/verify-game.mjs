/**
 * verify-game.mjs — Playwright smoke self-check: serve dist → zero console errors → three-state screenshots →
 * **direction-mapping assertions** (directly targets the most frequent playtest defect). When changing the input
 * mapping you must sync the assertions here.
 *
 * Usage: npm run build && node scripts/verify-game.mjs
 * Serves dist/public when a backend has been grafted on, otherwise dist/.
 *
 * Notes:
 * - The canvas is looked up by id — CANVAS_ID below must match the <canvas id="..."> that
 *   src/pages/Home.tsx renders. Rename it in one place and you must rename it in the other.
 * - Both WebGL and 2D canvases are supported: WebGL is read through readPixels (needs
 *   preserveDrawingBuffer), a 2D canvas through getImageData.
 * - Headless falls back to SwiftShader (software GL): it proves rendering/logic correctness only,
 *   never performance. Measure fps on a real GPU separately.
 * - Screenshots land in verification-shots/ (process files: review them, then delete the dir
 *   before delivery — the deliverable must not keep process artifacts).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: .pathname keeps percent-encoding, so a project living under a
// path with a space (or any non-ASCII character) would yield ".../My%20Games/app" and every
// existsSync() below would miss, reporting "no build output" for a build that is right there.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
// Build output location depends on whether a backend has been grafted on:
// plain game template -> dist/ ; after backend-building -> dist/public/ (dist/boot.js is the server bundle).
const DIST = existsSync(join(ROOT, "dist/public/index.html"))
  ? join(ROOT, "dist/public")
  : join(ROOT, "dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`VERIFY FAIL: no build output at ${DIST} — run \`npm run build\` first`);
  process.exit(1);
}
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });

// Must match <canvas id="..."> in src/pages/Home.tsx. Change both together.
const CANVAS_ID = "game-canvas";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    // Decode: request paths are percent-encoded, so an asset named "level 1.png" arrives as
    // "level%201.png" and would 404 (surfacing later as a bogus console-error failure).
    let path;
    try { path = decodeURIComponent(raw); } catch { path = raw; }
    const file = resolve(DIST, "." + path);
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});

const fail = (msg) => { console.error("VERIFY FAIL:", msg); server.close(); process.exit(1); };

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
// prefer the playwright-bundled browser; fall back to system chrome (CHROMIUM_PATH overrides)
const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/opt/gchrome/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);
let browser;
for (const exe of [null, ...CANDIDATES]) {
  try {
    browser = await chromium.launch(exe
      ? { executablePath: exe, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] }
      : {});
    break;
  } catch { /* try the next one */ }
}
if (!browser) fail("no usable browser found (playwright bundled/chrome/chromium all unavailable)");
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
const failedRequests = [];
const badResponses = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`));
page.on("response", (response) => {
  if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
});

await page.goto(`http://127.0.0.1:${port}/?verify=1`, { waitUntil: "networkidle" });
// The page boots through a React shell (src/main.tsx -> src/App.tsx -> src/pages/Home.tsx),
// so the canvas only exists after the first effect runs: wait for the readiness flag the game
// raises on its first rendered frame, then fall back to a fixed delay if it never appears.
await page
  .waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 8000 })
  .catch(() => console.warn("WARN: window.__GAME_READY__ never turned true — falling back to a fixed wait (raise the flag in src/game/boot.ts)"));
await page.waitForTimeout(1200);

// 1) The canvas must actually render content (not a black screen). Judge by reading the drawing
//    buffer, not the screenshot — on headless/swiftshader the compositor may show the canvas as
//    black while the drawing buffer holds the real frame. WebGL needs preserveDrawingBuffer for
//    that read (the template's src/game/boot.ts enables it); 2D canvases go through getImageData.
const shot = await page.evaluate((id) => {
  const SAMPLES = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
  const el = document.getElementById(id);
  if (!el) {
    const others = Array.from(document.querySelectorAll("canvas")).map((c) => c.id || "(no id)");
    return { kind: "no-canvas", others };
  }
  if (!(el instanceof HTMLCanvasElement)) return { kind: "not-canvas", tag: el.tagName.toLowerCase() };

  const gl = el.getContext("webgl2") || el.getContext("webgl");
  if (gl) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!w || !h) return { kind: "empty-buffer", api: "webgl", w, h };
    const px = new Uint8Array(4);
    let lit = 0;
    for (const [fx, fy] of SAMPLES) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[3] > 0 && px[0] + px[1] + px[2] > 8) lit++;
    }
    return { kind: "lit", api: "webgl", lit, total: SAMPLES.length };
  }

  const ctx = el.getContext("2d");
  if (ctx) {
    const w = el.width, h = el.height;
    if (!w || !h) return { kind: "empty-buffer", api: "2d", w, h };
    let lit = 0;
    try {
      for (const [fx, fy] of SAMPLES) {
        const d = ctx.getImageData((w * fx) | 0, (h * fy) | 0, 1, 1).data;
        if (d[3] > 0 && d[0] + d[1] + d[2] > 8) lit++;
      }
    } catch (e) {
      return { kind: "tainted", message: String(e) };
    }
    return { kind: "lit", api: "2d", lit, total: SAMPLES.length };
  }
  return { kind: "no-context" };
}, CANVAS_ID);

switch (shot.kind) {
  case "no-canvas":
    fail(
      `no element with id="${CANVAS_ID}" on the page, so the render check could not run.\\n` +
      `  URL: ${page.url()}\\n` +
      `  #root text: ${await page.locator("#root").innerText().catch(() => "(missing or unreadable)") }\\n` +
      `  #root HTML: ${(await page.locator("#root").innerHTML().catch(() => "(missing or unreadable)")).slice(0, 1600)}\\n` +
      `  Browser errors: ${consoleErrors.slice(0, 8).join(" | ") || "(none)"}\\n` +
      `  Failed requests: ${failedRequests.slice(0, 8).join(" | ") || "(none)"}\\n` +
      `  HTTP errors: ${badResponses.slice(0, 8).join(" | ") || "(none)"}\\n` +
      `  Other canvases: ${shot.others.join(", ") || "(none)"}\\n` +
      `  Fix the first runtime/load error; do not bypass the canvas assertion.`
    );
    break;
  case "not-canvas":
    fail(`the element with id="${CANVAS_ID}" is a <${shot.tag}>, not a <canvas> — give the canvas that id (src/pages/Home.tsx), or point CANVAS_ID at the right element.`);
    break;
  case "no-context":
    fail(`#${CANVAS_ID} exposes neither a WebGL nor a 2D context — this is not a drawable canvas, so "black" cannot be judged. Check how the renderer acquires its context in src/game/boot.ts.`);
    break;
  case "tainted":
    fail(`#${CANVAS_ID} is a 2D canvas whose pixels cannot be read back (${shot.message}) — a cross-origin image tainted it. Serve textures from the project itself so the render check can run.`);
    break;
  case "empty-buffer":
    fail(`#${CANVAS_ID} has a zero-sized ${shot.api} buffer (${shot.w}x${shot.h}) — the canvas was never sized. Set renderer.setSize()/canvas.width+height in src/game/boot.ts.`);
    break;
  case "lit":
    if (shot.lit < 2) {
      fail(shot.api === "webgl"
        ? `#${CANVAS_ID} (WebGL) is black: only ${shot.lit}/${shot.total} sampled pixels carry colour. If you are sure the game has visuals, check whether the renderer disabled preserveDrawingBuffer — without it the buffer reads back empty.`
        : `#${CANVAS_ID} (2D) is blank: only ${shot.lit}/${shot.total} sampled pixels carry colour. Nothing was drawn to the 2D context by the time of the check.`);
    }
    break;
  default:
    fail(`unexpected canvas check result: ${JSON.stringify(shot)}`);
}
await page.screenshot({ path: join(SHOTS, "01-title.png") });

// 2) Exercise the national-team browser and all confederation filters.
await page.getByRole("button", { name: "Форма и инвентарь" }).click();
await page.waitForSelector(".team-option");
const expectedTeams = [
  ["Азия", 12],
  ["Европа", 17],
  ["Африка", 1],
  ["Америка", 2],
  ["Все", 32],
];
for (const [region, expected] of expectedTeams) {
  await page.getByRole("button", { name: region, exact: true }).click();
  const actual = await page.locator(".team-option").count();
  if (actual !== expected) fail(`team filter "${region}" returned ${actual} teams; expected ${expected}`);
}
if (await page.locator(".team-option.selected").count() !== 1) {
  fail("the selected national team was lost while switching confederation filters");
}
await page.locator(".panel-title button").click();

// 3) Enter the dedicated training drill and verify its live objective HUD.
await page.getByRole("button", { name: /Тренировка/ }).click();
await page.getByRole("button", { name: /Начать упражнение/ }).click();
await page.waitForSelector(".training-progress");
const trainingObjective = await page.locator(".training-progress").innerText();
if (!trainingObjective.includes("/10")) fail("training objective HUD did not show the ten-hit target");

// 4) Enter regular play for direction and pause assertions.
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
await page.keyboard.press("Space");
await page.waitForTimeout(400);

// 4) Direction assertions: W raises the racket (Y increasing), D moves it right (X increasing).
async function playerPos() {
  return page.evaluate(() => window.__gameProbe ? window.__gameProbe() : null);
}
async function deltaAfter(key, ms = 500) {
  const before = await playerPos();
  if (!before) return null;
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  const after = await playerPos();
  return after ? { dx: after.x - before.x, dy: after.y - before.y } : null;
}

const probe = await page.evaluate(() => !!window.__gameProbe);
if (probe) {
  const dW = await deltaAfter("KeyW");
  if (dW && dW.dy <= 0.05) fail(`W did not raise the racket (dy=${dW?.dy.toFixed(3)}) — vertical mapping looks reversed`);
  const dD = await deltaAfter("KeyD");
  if (dD && dD.dx <= 0.05) fail(`D did not move the racket right (dx=${dD?.dx.toFixed(3)}) — horizontal mapping looks reversed`);
} else {
  console.warn("WARN: window.__gameProbe not injected, skipping direction assertions (expose a player-coordinate probe in src/game/boot.ts)");
}

// 5) Gameplay screenshot + Esc pause + restart
await page.screenshot({ path: join(SHOTS, "02-gameplay.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, "03-paused.png") });

// 6) Mobile viewport smoke: verify touch guidance, safe-area viewport and direct racket tracking.
const mobilePage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const mobileErrors = [];
mobilePage.on("console", (m) => { if (m.type() === "error") mobileErrors.push(m.text()); });
mobilePage.on("pageerror", (e) => mobileErrors.push(String(e)));
await mobilePage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await mobilePage.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 8000 });
await mobilePage.getByRole("button", { name: /Одиночный матч/ }).click();
await mobilePage.getByRole("button", { name: "Новичок" }).click();
await mobilePage.waitForTimeout(250);
const mobileUi = await mobilePage.evaluate(() => ({
  hintVisible: getComputedStyle(document.querySelector(".control-hint")).display !== "none",
  touchAction: getComputedStyle(document.querySelector("#game-canvas")).touchAction,
  viewportHeight: document.documentElement.clientHeight,
  gameHeight: document.querySelector("#game-root").getBoundingClientRect().height,
  probe: window.__gameProbe?.(),
}));
if (!mobileUi.hintVisible) fail("mobile touch-control hint is hidden");
if (mobileUi.touchAction !== "none") fail(`mobile canvas touch-action is ${mobileUi.touchAction}, expected none`);
if (Math.abs(mobileUi.viewportHeight - mobileUi.gameHeight) > 2) fail("mobile game surface does not fill the dynamic viewport");
const mobileBox = await mobilePage.locator("#game-canvas").boundingBox();
if (mobileBox) {
  const touch = await mobilePage.context().newCDPSession(mobilePage);
  const startX = mobileBox.x + mobileBox.width * 0.5;
  const startY = mobileBox.y + mobileBox.height * 0.65;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY, id: 1 }],
  });
  await mobilePage.waitForTimeout(80);
  const beforeDrag = await mobilePage.evaluate(() => window.__gameProbe?.());
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: startX, y: startY - 100, id: 1 }],
  });
  await mobilePage.waitForTimeout(300);
  const moved = await mobilePage.evaluate(() => window.__gameProbe?.());
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
  if (beforeDrag && moved && moved.y <= beforeDrag.y + 0.03) {
    fail(`dragging a finger upward must move the racket upward (before=${beforeDrag.y.toFixed(3)}, after=${moved.y.toFixed(3)})`);
  }
  if (mobileUi.probe && moved && Math.hypot(moved.x - mobileUi.probe.x, moved.y - mobileUi.probe.y) < 0.03) {
    fail("mobile touch drag did not move the racket");
  }
}
if (mobileErrors.length) fail(`mobile page reported ${mobileErrors.length} console error(s): ${mobileErrors[0]}`);
await mobilePage.close();

// 7) Run a deterministic end-to-end match in the real browser simulation.
// The verification hook drives both the human input and AI through the same
// fixed-step physics used by normal play; this catches regressions that unit
// tests alone cannot detect (serve → receive → rally → points → match end).
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Выйти в меню" }).click();
await page.getByRole("button", { name: "Одиночный матч" }).click();
await page.getByRole("button", { name: "Новичок" }).click();
await page.waitForFunction(() => typeof window.__gameVerifyMatch === "function");
const matchResult = await page.evaluate(() => window.__gameVerifyMatch());
if (matchResult.phase !== "gameover") {
  fail(`deterministic browser match did not finish (phase=${matchResult.phase}, games=${JSON.stringify(matchResult.games)})`);
}
if (matchResult.games[0] + matchResult.games[1] < 2) {
  fail(`deterministic browser match ended before two games were awarded: ${JSON.stringify(matchResult.games)}`);
}

// 8) Zero console errors
if (consoleErrors.length) fail(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);

await browser.close();
server.close();
console.log("VERIFY OK: render/team-filters/enter/direction/pause/console all passed; screenshots in verification-shots/");
