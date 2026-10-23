// Real WebView IPC only. Nothing starts without --run; no dependency downloads.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--run")) {
  console.log(
    "Usage: node scripts/smoke-query-cancellation.mjs --run --playwright-core <absolute module directory>",
  );
  console.log(
    "Builds a fresh debug executable in a unique target directory, then starts isolated app/Vite/HTTP fixture. Retains temporary evidence.",
  );
  process.exit(0);
}
assert.equal(process.platform, "win32", "This harness targets Windows WebView2");
const modulePath = args.includes("--playwright-core") ? option("--playwright-core") : "";
assert.ok(
  modulePath && path.isAbsolute(modulePath),
  "--playwright-core must name an installed absolute module directory",
);
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);
assert.equal(typeof chromium?.connectOverCDP, "function");
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(path.join(tmpdir(), "forge-a1-ipc-"));
console.log(`Evidence and isolated data: ${root}`);
const children = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function child(command, argv, env = process.env) {
  const proc = spawn(command, argv, { cwd: project, env, stdio: "inherit", windowsHide: true });
  children.push(proc);
  proc.on("error", (error) => {
    proc.spawnError = error;
  });
  return proc;
}
async function completed(proc) {
  return new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Build exited ${code}`)),
    );
  });
}
async function portAvailable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const selected = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return selected;
}
async function until(operation, timeout = 30000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (e) {
      error = e;
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${error?.message ?? "condition not reached"}`);
}
const gates = new Map();
const sockets = new Set();
let browser;
let fixture;
try {
  // A new target directory prevents accidentally launching an old, unisolated exe.
  const target = path.join(root, "target");
  await mkdir(path.join(root, "data"));
  const vitePort = await portAvailable(0);
  const devUrl = `http://127.0.0.1:${vitePort}`;
  const cdpPort = await portAvailable(0);
  const buildEnv = {
    ...process.env,
    CARGO_TARGET_DIR: target,
    CARGO_PROFILE_DEV_DEBUG_ASSERTIONS: "true",
    RUSTFLAGS: "-C debug-assertions=yes",
  };
  delete buildEnv.CARGO_ENCODED_RUSTFLAGS;
  delete buildEnv.CARGO_BUILD_RUSTFLAGS;
  delete buildEnv.CARGO_BUILD_TARGET;
  buildEnv.TAURI_CONFIG = JSON.stringify({
    build: { devUrl },
    app: {
      windows: [
        {
          label: "main",
          title: "Forge UI — 隔离验收",
          width: 1000,
          height: 750,
          dataDirectory: path.join(root, "webview"),
          additionalBrowserArgs: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1`,
        },
      ],
    },
  });
  delete buildEnv.TAURI_ENV_CONFIG;
  await completed(
    child(
      "cargo",
      [
        "build",
        "--locked",
        "--offline",
        "--manifest-path",
        path.join(project, "src-tauri", "Cargo.toml"),
        "--bin",
        "app",
        "--target-dir",
        target,
      ],
      buildEnv,
    ),
  );
  const executable = path.join(target, "debug", "app.exe");
  assert.ok((await stat(executable)).isFile());
  const vite = child(process.execPath, [
    path.join(project, "node_modules", "vite", "bin", "vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(vitePort),
    "--strictPort",
  ]);
  await until(async () => {
    if (vite.spawnError || vite.exitCode !== null) throw new Error("Vite failed");
    return (await fetch(devUrl)).ok;
  });
  fixture = http.createServer((req, res) => {
    const key = req.url;
    const gate = gates.get(key);
    if (!gate) {
      res.writeHead(404);
      res.end();
      return;
    }
    gate.hits++;
    res.setHeader("Content-Type", "application/json");
    if (gate.phase === "body") {
      res.writeHead(200);
      res.flushHeaders();
      res.write('{"ok":');
    }
    gate.release = () => {
      if (!res.destroyed) res.end(gate.phase === "body" ? "true}" : '{"ok":true}');
    };
    gate.reached = true;
    if (gate.phase === "fast") gate.release();
  });
  fixture.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  const appEnv = {
    ...process.env,
    FORGE_UI_TEST_DATA_DIR: path.join(root, "data"),
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1`,
  };
  delete appEnv.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;
  const app = child(executable, [], appEnv);
  await until(async () => {
    if (app.spawnError || app.exitCode !== null) throw new Error("App exited");
    return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
  });
  // Confirm the isolated startup database exists before issuing any command.
  await until(async () => (await stat(path.join(root, "data", "forge.db"))).isFile());
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = await until(async () => {
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        if (
          new URL(page.url()).origin === devUrl &&
          (await page.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === "function"))
        )
          return page;
      }
  });
  // Explicit allowlist excludes every secret/model IPC command.
  const allowed = new Set(["create_project", "save_api_document", "execute_api", "cancel_query"]);
  const invoke = (command, parameters) => {
    assert.ok(allowed.has(command));
    return page.evaluate(
      ({ command, parameters }) => window.__TAURI_INTERNALS__.invoke(command, parameters),
      { command, parameters },
    );
  };
  const projectId = `a1-${randomUUID()}`;
  const docId = `a1-${randomUUID()}`;
  await invoke("create_project", { id: projectId, name: "Isolated cancellation smoke" });
  await invoke("save_api_document", {
    id: docId,
    projectId,
    name: "Loopback fixture",
    enabled: true,
    payload: JSON.stringify({
      spec: {},
      auth: {
        type: "none",
        apiBaseUrl: base,
        authorizedOperations: ["GET /headers", "GET /body", "GET /fast"],
      },
    }),
  });
  for (const phase of ["headers", "body", "fast"]) {
    const route = phase === "headers" ? "/headers" : phase === "body" ? "/body" : "/fast";
    const gate = { phase, hits: 0, reached: false };
    gates.set(route, gate);
    const requestId = `a1-${randomUUID()}`;
    // Attach rejection handling immediately; keep CDP free for the cancel call.
    await page.evaluate(
      ({ base, route, projectId, docId, requestId }) => {
        window.__a1SmokeResult = { settled: false };
        window.__TAURI_INTERNALS__
          .invoke("execute_api", {
            request: {
              url: base + route,
              method: "GET",
              project_id: projectId,
              api_document_id: docId,
              operation_key: `GET ${route}`,
              request_id: requestId,
            },
          })
          .then(
            (value) => {
              window.__a1SmokeResult = { settled: true, value };
            },
            (error) => {
              window.__a1SmokeResult = { settled: true, error: String(error) };
            },
          );
      },
      { base, route, projectId, docId, requestId },
    );
    await until(() => gate.reached);
    if (phase !== "fast") assert.equal(await invoke("cancel_query", { requestId }), 1);
    const result = await until(
      () => page.evaluate(() => (window.__a1SmokeResult.settled ? window.__a1SmokeResult : null)),
      5000,
    );
    if (phase === "fast") assert.equal(result.value?.status, 200);
    else assert.equal(result.error, "Cancelled");
    assert.equal(await invoke("cancel_query", { requestId }), 0);
    gate.release();
    assert.equal(gate.hits, 1);
    console.log(
      `PASS native IPC ${phase}${phase === "fast" ? " completion then cancel=0" : " cancellation then cancel=0"}`,
    );
  }
  console.log(
    "PASS real WebView → Tauri IPC → Rust → loopback HTTP cancellation smoke. UI rendering was not asserted.",
  );
} finally {
  // Kill only trees created here; closing the app window merely hides its tray.
  for (const proc of children.reverse())
    if (proc.pid && proc.exitCode === null) {
      await new Promise((resolve) => {
        const kill = spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        kill.once("exit", resolve);
        kill.once("error", resolve);
      });
    }
  for (const socket of sockets) socket.destroy();
  if (fixture) await new Promise((resolve) => fixture.close(resolve));
  // App process tree has already been stopped; release the CDP transport.
  if (browser?.isConnected()) await browser.close().catch(() => {});
  console.log(`Retained only this run's temporary files at ${root}`);
}
