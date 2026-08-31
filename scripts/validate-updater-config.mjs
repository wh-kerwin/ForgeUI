import { readFile } from "node:fs/promises";
import process from "node:process";

const file =
  process.argv[2] || process.env.TAURI_UPDATER_CONFIG || "src-tauri/tauri.updater.release.json";

function fail(message) {
  console.error(`updater config invalid: ${message}`);
  process.exitCode = 1;
}

let document;
try {
  document = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  fail(`cannot read JSON (${error instanceof Error ? error.message : "unknown error"})`);
}

if (!document) process.exit();
const updater = document.plugins?.updater;
if (!updater || typeof updater !== "object") fail("plugins.updater is required");

const pubkey = typeof updater?.pubkey === "string" ? updater.pubkey.trim() : "";
if (pubkey.length < 32 || /REPLACE|YOUR_|EXAMPLE|PRIVATE/i.test(pubkey)) {
  fail("pubkey must be a real public key, not a placeholder");
}
if (Object.keys(updater || {}).some((key) => /private|secret|password|token/i.test(key))) {
  fail("private credentials must never be present in updater config");
}

const endpoints = updater?.endpoints;
if (!Array.isArray(endpoints) || endpoints.length === 0) fail("at least one endpoint is required");
for (const endpoint of endpoints || []) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") fail(`endpoint must use HTTPS: ${url.origin}`);
    if (/example\.(com|org|net)|\.invalid$/i.test(url.hostname))
      fail("endpoint is still an example/invalid host");
  } catch {
    fail("endpoint is not a valid URL");
  }
}

if (process.exitCode !== 1) console.log("updater config is valid (credentials were not printed)");
