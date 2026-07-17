"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "browser-extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));

assert.strictEqual(manifest.manifest_version, 3);
assert.deepStrictEqual(manifest.permissions.sort(), ["storage", "unlimitedStorage"].sort());
assert(manifest.host_permissions.every((pattern) => pattern.includes("doubao.com")), "Host permissions must stay scoped to Doubao");

const referencedFiles = [
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...manifest.content_scripts.flatMap((entry) => [...entry.css, ...entry.js]),
];
for (const relativePath of referencedFiles) {
  assert(fs.existsSync(path.join(extensionRoot, relativePath)), `Missing manifest file: ${relativePath}`);
}

require(path.join(extensionRoot, "shared", "defaults.js"));
const shared = globalThis.DoubaoDreamSkinShared;
assert(shared);

const normalized = shared.normalizeConfig({
  enabled: false,
  backgroundBrightness: 999,
  backgroundSaturation: -2,
  blurPixels: 120,
  sidebarColor: "javascript:alert(1)",
  surfaceAlpha: -10,
  composerAlpha: 2,
  backgroundImage: "data:text/html;base64,PHNjcmlwdD4=",
});
assert.strictEqual(normalized.enabled, false);
assert.strictEqual(normalized.backgroundBrightness, 130);
assert.strictEqual(normalized.backgroundSaturation, 0);
assert.strictEqual(normalized.blurPixels, 60);
assert.strictEqual(normalized.sidebarColor, shared.DEFAULT_CONFIG.sidebarColor);
assert.strictEqual(normalized.surfaceAlpha, 0);
assert.strictEqual(normalized.composerAlpha, 20);
assert.strictEqual(normalized.backgroundImage, null);
assert.strictEqual(shared.hexToRgba("#0c2238", 42), "rgba(12, 34, 56, 0.42)");

const contentScript = fs.readFileSync(path.join(extensionRoot, "content", "content.js"), "utf8");
const contentCss = fs.readFileSync(path.join(extensionRoot, "content", "content.css"), "utf8");
assert(!/\beval\s*\(|new\s+Function\s*\(/.test(contentScript), "Remote or evaluated code is not allowed");
for (const selector of ["#chat-route-layout", "#chat-route-main", "#flow_chat_sidebar", "#input-engine-container"]) {
  assert(contentCss.includes(selector), `Missing stable Doubao selector: ${selector}`);
}

for (const htmlPath of [manifest.action.default_popup, manifest.options_ui.page]) {
  const html = fs.readFileSync(path.join(extensionRoot, htmlPath), "utf8");
  assert(!/\son[a-z]+\s*=/.test(html), `Inline event handler is not allowed: ${htmlPath}`);
  assert(!/<script(?![^>]+\bsrc=)/i.test(html), `Inline script is not allowed: ${htmlPath}`);
}

console.log(JSON.stringify({
  ok: true,
  test: "browser-extension",
  version: manifest.version,
  files: referencedFiles.length,
}, null, 2));
