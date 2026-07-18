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
  textColorMode: "script",
  textColor: "url(javascript:alert(1))",
  themePreset: "javascript",
  componentStyle: "broken",
  accentColor: "url(javascript:alert(1))",
  cardAlpha: -1,
  userBubbleAlpha: 999,
  cornerRadius: 100,
  shadowStrength: -20,
  backgroundImage: "data:text/html;base64,PHNjcmlwdD4=",
});
assert.strictEqual(normalized.enabled, false);
assert.strictEqual(normalized.backgroundBrightness, 130);
assert.strictEqual(normalized.backgroundSaturation, 0);
assert.strictEqual(normalized.blurPixels, 60);
assert.strictEqual(normalized.sidebarColor, shared.DEFAULT_CONFIG.sidebarColor);
assert.strictEqual(normalized.surfaceAlpha, 0);
assert.strictEqual(normalized.composerAlpha, 20);
assert.strictEqual(normalized.textColorMode, "auto");
assert.strictEqual(normalized.textColor, shared.DEFAULT_CONFIG.textColor);
assert.strictEqual(normalized.themePreset, shared.DEFAULT_CONFIG.themePreset);
assert.strictEqual(normalized.componentStyle, shared.DEFAULT_CONFIG.componentStyle);
assert.strictEqual(normalized.accentColor, shared.DEFAULT_CONFIG.accentColor);
assert.strictEqual(normalized.cardAlpha, 20);
assert.strictEqual(normalized.userBubbleAlpha, 100);
assert.strictEqual(normalized.cornerRadius, 32);
assert.strictEqual(normalized.shadowStrength, 0);
assert.strictEqual(normalized.backgroundImage, null);
assert.strictEqual(shared.hexToRgba("#0c2238", 42), "rgba(12, 34, 56, 0.42)");
assert.strictEqual(Object.keys(shared.THEME_PRESETS).length, 4);
const midnight = shared.applyPreset(shared.DEFAULT_CONFIG, "midnight-neon");
assert.strictEqual(midnight.themePreset, "midnight-neon");
assert.strictEqual(midnight.componentStyle, "solid");
assert.strictEqual(midnight.accentColor, "#22d3ee");

require(path.join(extensionRoot, "shared", "color-engine.js"));
const colorEngine = globalThis.DoubaoDreamSkinColor;
assert(colorEngine);
assert.strictEqual(Number(colorEngine.contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(0)), 21);
const darkProfile = {
  sidebar: [[8, 10, 14]],
  main: [[12, 14, 18]],
  composer: [[18, 20, 24]],
};
const lightProfile = {
  sidebar: [[248, 248, 248]],
  main: [[244, 246, 248]],
  composer: [[250, 250, 250]],
};
const transparentPanels = shared.normalizeConfig({
  ...shared.DEFAULT_CONFIG,
  sidebarAlpha: 15,
  surfaceAlpha: 0,
  composerAlpha: 20,
});
assert.strictEqual(colorEngine.resolvePalette(transparentPanels, darkProfile).main.tone, "light");
assert.strictEqual(colorEngine.resolvePalette(transparentPanels, lightProfile).main.tone, "dark");
const customPalette = colorEngine.resolvePalette(shared.normalizeConfig({
  ...shared.DEFAULT_CONFIG,
  textColorMode: "custom",
  textColor: "#224466",
  mutedTextColor: "#6688aa",
}), lightProfile);
assert.strictEqual(customPalette.sidebar.primary, "#224466");
assert.strictEqual(customPalette.composer.muted, "#6688aa");

const contentScript = fs.readFileSync(path.join(extensionRoot, "content", "content.js"), "utf8");
const contentCss = fs.readFileSync(path.join(extensionRoot, "content", "content.css"), "utf8");
assert(!/\beval\s*\(|new\s+Function\s*\(/.test(contentScript), "Remote or evaluated code is not allowed");
for (const selector of ["#chat-route-layout", "#chat-route-main", "#flow_chat_sidebar", "#input-engine-container"]) {
  assert(contentCss.includes(selector), `Missing stable Doubao selector: ${selector}`);
}
for (const token of [
  "--dbsw-sidebar-text", "--dbsw-main-text", "--dbsw-composer-text",
  "--dbsw-accent", "--dbsw-card", "--dbsw-user-bubble", "--dbsw-assistant-bubble",
  "--dbsw-radius", "--dbsw-elevation",
]) {
  assert(contentScript.includes(token), `Missing adaptive text token: ${token}`);
  assert(contentCss.includes(token), `Missing adaptive text CSS token: ${token}`);
}

for (const htmlPath of [manifest.action.default_popup, manifest.options_ui.page]) {
  const html = fs.readFileSync(path.join(extensionRoot, htmlPath), "utf8");
  assert(!/\son[a-z]+\s*=/.test(html), `Inline event handler is not allowed: ${htmlPath}`);
  assert(!/<script(?![^>]+\bsrc=)/i.test(html), `Inline script is not allowed: ${htmlPath}`);
}
const optionsHtml = fs.readFileSync(path.join(extensionRoot, manifest.options_ui.page), "utf8");
for (const control of [
  "textColorMode", "textColor", "mutedTextColor", "textAnalysis", "presetList",
  "componentStyle", "accentColor", "accentTextColor", "cardColor", "cardAlpha",
  "userBubbleColor", "userBubbleAlpha", "assistantBubbleColor", "assistantBubbleAlpha",
  "cornerRadius", "shadowStrength",
]) {
  assert(optionsHtml.includes(`id="${control}"`), `Missing text color setting: ${control}`);
}

console.log(JSON.stringify({
  ok: true,
  test: "browser-extension",
  version: manifest.version,
  files: referencedFiles.length,
}, null, 2));
