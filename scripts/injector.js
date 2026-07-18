#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const {
  CdpClient,
  encodeClientFrame,
  httpGetJson,
  validateDebuggerUrl,
} = require("./cdp-client");

const VERSION = "0.4.0";
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const USER_THEME = path.join(PROJECT_ROOT, "config", "theme.json");
const DEFAULT_THEME = fs.existsSync(USER_THEME)
  ? USER_THEME
  : path.join(PROJECT_ROOT, "config", "theme.example.json");
const DEFAULT_CSS = path.join(PROJECT_ROOT, "assets", "dream-skin.css");
const DEFAULT_TEMPLATE = path.join(PROJECT_ROOT, "assets", "renderer-inject.js");

function parseArgs(argv) {
  const options = {
    mode: "watch",
    port: 9336,
    themePath: DEFAULT_THEME,
    stateDir: null,
    screenshot: null,
    intervalMs: 1800,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.mode = "watch";
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--inspect") options.mode = "inspect";
    else if (arg === "--inspect-targets") options.mode = "inspect-targets";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--self-test") options.mode = "self-test";
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--theme") options.themePath = path.resolve(argv[++index]);
    else if (arg === "--state-dir") options.stateDir = path.resolve(argv[++index]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++index]);
    else if (arg === "--interval-ms") options.intervalMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.mode !== "self-test") {
    if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
      throw new Error(`Invalid CDP port: ${options.port}`);
    }
  }
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 500 || options.intervalMs > 30000) {
    throw new Error(`Invalid watch interval: ${options.intervalMs}`);
  }
  return options;
}

function assertShortText(value, name, fallback, maxLength) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${name} must be a short single-line string`);
  }
  return value;
}

function assertNumber(value, name, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return number;
}

function assertCssColor(value, name, fallback) {
  const color = assertShortText(value, name, fallback, 120).trim();
  if (!/^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^;{}]{1,100}\))$/i.test(color)) {
    throw new Error(`${name} is not a supported CSS color`);
  }
  return color;
}

function ensureInsideProject(candidate, name) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(PROJECT_ROOT, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${name} must stay inside the project directory`);
  }
  return resolved;
}

async function loadTheme(themePath) {
  const resolvedThemePath = ensureInsideProject(themePath, "Theme file");
  const text = await fsp.readFile(resolvedThemePath, "utf8");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid theme JSON: ${error.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Theme root must be an object");
  const relativeImage = assertShortText(raw.backgroundImage, "backgroundImage", null, 300);
  if (!relativeImage || path.isAbsolute(relativeImage)) throw new Error("backgroundImage must be a relative path");
  const imagePath = ensureInsideProject(path.resolve(path.dirname(resolvedThemePath), relativeImage), "Background image");
  const extension = path.extname(imagePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp", ".svg"].includes(extension)) {
    throw new Error("Background image must be JPG, PNG, WebP, or SVG");
  }
  const imageBytes = await fsp.readFile(imagePath);
  if (imageBytes.length < 1 || imageBytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Background image must be between 1 byte and ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  }
  const patternValues = Array.isArray(raw.targetUrlPatterns) ? raw.targetUrlPatterns : [];
  if (patternValues.length < 1 || patternValues.length > 12) throw new Error("targetUrlPatterns must contain 1 to 12 entries");
  const targetPatterns = patternValues.map((entry, index) => {
    const source = assertShortText(entry, `targetUrlPatterns[${index}]`, null, 240);
    try {
      return new RegExp(source, "i");
    } catch (error) {
      throw new Error(`Invalid targetUrlPatterns[${index}]: ${error.message}`);
    }
  });
  const textColorMode = assertShortText(raw.textColorMode, "textColorMode", "auto", 16).toLowerCase();
  if (!["auto", "dark", "light", "custom"].includes(textColorMode)) {
    throw new Error("textColorMode must be auto, dark, light, or custom");
  }
  const theme = {
    id: assertShortText(raw.id, "id", "custom", 80),
    name: assertShortText(raw.name, "name", "Doubao Dream Skin", 120),
    backgroundPosition: assertShortText(raw.backgroundPosition, "backgroundPosition", "center center", 80),
    backgroundBrightness: assertNumber(raw.backgroundBrightness, "backgroundBrightness", 0.85, 0.2, 1.5),
    backgroundSaturation: assertNumber(raw.backgroundSaturation, "backgroundSaturation", 1, 0, 2),
    overlayColor: assertCssColor(raw.overlayColor, "overlayColor", "rgba(0, 0, 0, 0.12)"),
    sidebarColor: assertCssColor(raw.sidebarColor, "sidebarColor", "rgba(255, 255, 255, 0.72)"),
    surfaceColor: assertCssColor(raw.surfaceColor, "surfaceColor", "rgba(255, 255, 255, 0.48)"),
    composerColor: assertCssColor(raw.composerColor, "composerColor", "rgba(255, 255, 255, 0.82)"),
    borderColor: assertCssColor(raw.borderColor, "borderColor", "rgba(0, 0, 0, 0.14)"),
    shadowColor: assertCssColor(raw.shadowColor, "shadowColor", "rgba(0, 0, 0, 0.16)"),
    accentColor: assertCssColor(raw.accentColor, "accentColor", "#b85f4b"),
    textColorMode,
    textColor: assertCssColor(raw.textColor, "textColor", "#1f2329"),
    mutedTextColor: assertCssColor(raw.mutedTextColor, "mutedTextColor", "#59636f"),
    blurPixels: assertNumber(raw.blurPixels, "blurPixels", 20, 0, 60),
    targetPatterns,
  };
  const mime = extension === ".png"
    ? "image/png"
    : extension === ".webp"
      ? "image/webp"
      : extension === ".svg"
        ? "image/svg+xml"
        : "image/jpeg";
  const fingerprint = crypto.createHash("sha256").update(text).update("\0").update(imageBytes).digest("hex");
  return {
    theme,
    themePath: resolvedThemePath,
    imagePath,
    imageBytes,
    backgroundDataUrl: `data:${mime};base64,${imageBytes.toString("base64")}`,
    fingerprint,
  };
}

async function loadPayload(themePath) {
  const loaded = await loadTheme(themePath);
  const [css, template] = await Promise.all([fsp.readFile(DEFAULT_CSS, "utf8"), fsp.readFile(DEFAULT_TEMPLATE, "utf8")]);
  const payloadFingerprint = crypto.createHash("sha256")
    .update(loaded.fingerprint)
    .update("\0")
    .update(css)
    .update("\0")
    .update(template)
    .digest("hex");
  const publicTheme = { ...loaded.theme };
  delete publicTheme.targetPatterns;
  const replacements = new Map([
    ["__DBS_VERSION_JSON__", JSON.stringify(VERSION)],
    ["__DBS_FINGERPRINT_JSON__", JSON.stringify(payloadFingerprint)],
    ["__DBS_CSS_JSON__", JSON.stringify(css)],
    ["__DBS_BACKGROUND_JSON__", JSON.stringify(loaded.backgroundDataUrl)],
    ["__DBS_THEME_JSON__", JSON.stringify(publicTheme)],
  ]);
  let payload = template;
  for (const [token, replacement] of replacements) payload = payload.split(token).join(replacement);
  if (/__DBS_[A-Z_]+__/.test(payload)) throw new Error("Renderer payload contains an unresolved template token");
  return { ...loaded, fingerprint: payloadFingerprint, payload };
}

async function getPayloadSourceStamp(loadedTheme) {
  const stats = await Promise.all([
    fsp.stat(loadedTheme.themePath),
    fsp.stat(loadedTheme.imagePath),
    fsp.stat(DEFAULT_CSS),
    fsp.stat(DEFAULT_TEMPLATE),
  ]);
  return stats.map((stat) => `${stat.size}:${stat.mtimeMs}`).join("|");
}

function targetUrlMatches(url, loadedTheme) {
  if (typeof url !== "string") return false;
  return loadedTheme.theme.targetPatterns.some((pattern) => pattern.test(url));
}

async function getBrowserIdentity(port) {
  const version = await httpGetJson(port, "/json/version", 2500);
  const validated = validateDebuggerUrl(version.webSocketDebuggerUrl, port, new Set(["browser"]));
  return { id: validated.id, product: version.Browser || version.Product || "unknown" };
}

async function listPageTargets(port, expectedBrowserId) {
  const identity = await getBrowserIdentity(port);
  if (expectedBrowserId && identity.id !== expectedBrowserId) {
    throw new Error("The CDP browser identity changed; stopping to avoid attaching to another program");
  }
  const targets = await httpGetJson(port, "/json/list", 2500);
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array");
  return targets.filter((target) => {
    if (target?.type !== "page" || typeof target.id !== "string" || !target.webSocketDebuggerUrl) return false;
    try {
      const validated = validateDebuggerUrl(target.webSocketDebuggerUrl, port, new Set(["page"]));
      return validated.id === target.id;
    } catch (_) {
      return false;
    }
  });
}

async function connectTarget(target, port) {
  const client = new CdpClient(target.webSocketDebuggerUrl, port, 12000);
  await client.connect();
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return client;
}

async function probeTarget(client) {
  return client.evaluate(`(() => ({
    href: location.href,
    title: document.title,
    hostname: location.hostname,
    readyState: document.readyState,
    hasRoot: Boolean(document.querySelector('#root, #app, [role="main"]')),
    hasComposer: Boolean(document.querySelector('textarea, [contenteditable="true"]')),
    marked: Boolean(document.documentElement?.dataset?.doubaoDreamSkin),
  }))()`);
}

async function injectTarget(target, port, loadedTheme, registerEarly, previousScriptId) {
  const client = await connectTarget(target, port);
  try {
    const probe = await probeTarget(client);
    if (!targetUrlMatches(target.url, loadedTheme) && !targetUrlMatches(probe?.href, loadedTheme)) {
      return { injected: false, targetId: target.id, url: probe?.href || target.url, title: probe?.title || target.title };
    }
    let scriptId = null;
    if (registerEarly) {
      if (previousScriptId) {
        try {
          await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: previousScriptId });
        } catch (_) {}
      }
      const registered = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: loadedTheme.payload });
      scriptId = registered.identifier || null;
    }
    const result = await client.evaluate(loadedTheme.payload);
    return {
      injected: Boolean(result?.ok),
      targetId: target.id,
      scriptId,
      url: result?.href || probe?.href || target.url,
      title: result?.title || probe?.title || target.title,
      reused: Boolean(result?.reused),
    };
  } finally {
    client.close();
  }
}

async function inspectTarget(target, port) {
  const client = await connectTarget(target, port);
  try {
    const result = await client.evaluate(`(() => ({
      href: location.href,
      title: document.title,
      marked: document.documentElement?.dataset?.doubaoDreamSkin || null,
      hasStyle: Boolean(document.getElementById('doubao-dream-skin-style')),
      hasBackground: Boolean(document.getElementById('doubao-dream-skin-background')),
      fingerprint: window.__doubaoDreamSkin?.fingerprint || null,
      textDecision: document.documentElement?.dataset?.doubaoDreamSkinText || null,
      textPalette: window.__doubaoDreamSkin?.getTextPalette?.() || null,
    }))()`);
    return { targetId: target.id, ...result, client };
  } catch (error) {
    client.close();
    throw error;
  }
}

async function removeFromTarget(target, port, scriptId) {
  const client = await connectTarget(target, port);
  try {
    if (scriptId) {
      try {
        await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
      } catch (_) {
        // Cleanup of the current document is still useful if the target was recreated.
      }
    }
    return await client.evaluate(`(() => {
      try { window.__doubaoDreamSkin?.cleanup?.(); } catch (_) {}
      document.getElementById('doubao-dream-skin-style')?.remove();
      document.getElementById('doubao-dream-skin-background')?.remove();
      if (document.documentElement) delete document.documentElement.dataset.doubaoDreamSkin;
      return { ok: true, href: location.href, title: document.title };
    })()`);
  } finally {
    client.close();
  }
}

async function atomicWriteJson(filePath, value) {
  if (!filePath) return;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, filePath).catch(async (error) => {
    if (process.platform === "win32" && (error.code === "EEXIST" || error.code === "EPERM")) {
      await fsp.unlink(filePath).catch(() => {});
      await fsp.rename(temporary, filePath);
      return;
    }
    throw error;
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function injectPass(options, browserId, loadedTheme, seenTargets, forceAudit) {
  const targets = await listPageTargets(options.port, browserId);
  const results = [];
  const liveIds = new Set(targets.map((target) => target.id));
  for (const knownId of Array.from(seenTargets.keys())) {
    if (!liveIds.has(knownId)) seenTargets.delete(knownId);
  }
  for (const target of targets) {
    const known = seenTargets.get(target.id);
    if (known?.fingerprint === loadedTheme.fingerprint && !forceAudit) continue;
    try {
      const themeChanged = Boolean(known && known.fingerprint !== loadedTheme.fingerprint);
      const result = await injectTarget(target, options.port, loadedTheme, !known || themeChanged, themeChanged ? known.scriptId : null);
      results.push(result);
      if (result.injected) {
        seenTargets.set(target.id, { fingerprint: loadedTheme.fingerprint, scriptId: result.scriptId || known?.scriptId || null });
      }
    } catch (error) {
      results.push({ injected: false, targetId: target.id, url: target.url, error: error.message });
    }
  }
  return results;
}

async function runWatch(options) {
  const stateDir = options.stateDir || path.join(process.env.LOCALAPPDATA || PROJECT_ROOT, "DoubaoDreamSkin");
  const statusPath = path.join(stateDir, "status.json");
  const identity = await getBrowserIdentity(options.port);
  let loadedTheme = await loadPayload(options.themePath);
  let themeStamp = await getPayloadSourceStamp(loadedTheme);
  const seenTargets = new Map();
  let stopped = false;
  let passNumber = 0;
  process.on("SIGINT", () => { stopped = true; });
  process.on("SIGTERM", () => { stopped = true; });
  console.log(`Doubao Dream Skin ${VERSION} watching CDP ${options.port} (${identity.product})`);

  while (!stopped) {
    passNumber += 1;
    try {
      const currentStamp = await getPayloadSourceStamp(loadedTheme);
      if (currentStamp !== themeStamp) {
        loadedTheme = await loadPayload(options.themePath);
        themeStamp = currentStamp;
      }
      const results = await injectPass(options, identity.id, loadedTheme, seenTargets, passNumber % 10 === 0);
      const injected = Array.from(seenTargets.keys());
      await atomicWriteJson(statusPath, {
        schemaVersion: 1,
        active: true,
        version: VERSION,
        browserId: identity.id,
        port: options.port,
        theme: { id: loadedTheme.theme.id, name: loadedTheme.theme.name, fingerprint: loadedTheme.fingerprint },
        injectedTargetIds: injected,
        registeredScripts: Array.from(seenTargets.entries()).map(([targetId, value]) => ({
          targetId,
          scriptId: value.scriptId,
        })).filter((item) => item.scriptId),
        lastResults: results,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await atomicWriteJson(statusPath, {
        schemaVersion: 1,
        active: false,
        version: VERSION,
        port: options.port,
        error: error.message,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
      console.error(error.stack || error.message);
      if (/identity changed|ECONNREFUSED|CDP HTTP/.test(error.message)) process.exitCode = 1;
      if (process.exitCode) break;
    }
    await delay(options.intervalMs);
  }
}

async function runOnce(options) {
  const identity = await getBrowserIdentity(options.port);
  const loadedTheme = await loadPayload(options.themePath);
  const results = await injectPass(options, identity.id, loadedTheme, new Map(), true);
  console.log(JSON.stringify({ ok: results.some((item) => item.injected), browserId: identity.id, results }, null, 2));
  if (!results.some((item) => item.injected)) process.exitCode = 2;
}

async function runVerify(options) {
  const identity = await getBrowserIdentity(options.port);
  const loadedTheme = await loadPayload(options.themePath);
  const targets = await listPageTargets(options.port, identity.id);
  const reports = [];
  let screenshotSaved = false;
  for (const target of targets) {
    let report;
    try {
      report = await inspectTarget(target, options.port);
      const client = report.client;
      delete report.client;
      if (report.marked && report.hasStyle && report.hasBackground && report.fingerprint === loadedTheme.fingerprint) {
        if (options.screenshot && !screenshotSaved) {
          const capture = await client.send("Page.captureScreenshot", { format: "png", fromSurface: false, captureBeyondViewport: false });
          await fsp.mkdir(path.dirname(options.screenshot), { recursive: true });
          await fsp.writeFile(options.screenshot, Buffer.from(capture.data, "base64"));
          screenshotSaved = true;
          report.screenshot = options.screenshot;
        }
      }
      client.close();
    } catch (error) {
      report = { targetId: target.id, href: target.url, title: target.title, error: error.message };
    }
    reports.push(report);
  }
  const ok = reports.some((report) => report.marked && report.hasStyle && report.hasBackground && report.fingerprint === loadedTheme.fingerprint);
  console.log(JSON.stringify({ ok, browserId: identity.id, theme: loadedTheme.theme.name, screenshotSaved, reports }, null, 2));
  if (!ok) process.exitCode = 2;
}

async function runRemove(options) {
  const identity = await getBrowserIdentity(options.port);
  const targets = await listPageTargets(options.port, identity.id);
  const scriptsByTarget = new Map();
  if (options.stateDir) {
    try {
      const status = JSON.parse(await fsp.readFile(path.join(options.stateDir, "status.json"), "utf8"));
      for (const entry of status.registeredScripts || []) {
        if (typeof entry?.targetId === "string" && typeof entry?.scriptId === "string") {
          scriptsByTarget.set(entry.targetId, entry.scriptId);
        }
      }
    } catch (_) {
      // A missing status file must not prevent best-effort current-page cleanup.
    }
  }
  const results = [];
  for (const target of targets) {
    try {
      results.push({ targetId: target.id, ...(await removeFromTarget(target, options.port, scriptsByTarget.get(target.id))) });
    } catch (error) {
      results.push({ targetId: target.id, ok: false, error: error.message });
    }
  }
  console.log(JSON.stringify({ ok: results.some((item) => item.ok), results }, null, 2));
}

async function runInspect(options) {
  const identity = await getBrowserIdentity(options.port);
  const loadedTheme = await loadPayload(options.themePath);
  const targets = await listPageTargets(options.port, identity.id);
  const reports = [];
  for (const target of targets) {
    const client = await connectTarget(target, options.port);
    try {
      const probe = await probeTarget(client);
      const elements = await client.evaluate(`(() => {
        const viewportArea = Math.max(1, innerWidth * innerHeight);
        const items = Array.from(document.querySelectorAll('body *')).map((element, index) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const area = Math.max(0, rect.width) * Math.max(0, rect.height);
          return {
            index,
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            classes: typeof element.className === 'string' ? element.className.slice(0, 240) : null,
            role: element.getAttribute('role'),
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage === 'none' ? null : style.backgroundImage.slice(0, 160),
            position: style.position,
            zIndex: style.zIndex,
            overflow: style.overflow,
            rect: {
              x: Math.round(rect.x), y: Math.round(rect.y),
              width: Math.round(rect.width), height: Math.round(rect.height),
            },
            areaRatio: Math.round((area / viewportArea) * 10000) / 10000,
            childCount: element.childElementCount,
          };
        }).filter((item) => (
          item.areaRatio >= 0.025 ||
          (item.areaRatio >= 0.005 && item.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
          (item.rect.width >= 150 && item.rect.height >= 24 && item.rect.height <= 80) ||
          ['main', 'aside', 'nav', 'form'].includes(item.tag)
        ));
        items.sort((left, right) => right.areaRatio - left.areaRatio || left.index - right.index);
        const hitPoints = [
          [880, 220], [1000, 220], [1140, 220],
          [880, 240], [1000, 240], [1140, 240],
          [880, 260], [1000, 260], [1140, 260],
        ];
        const hits = hitPoints.map(([x, y]) => ({
          x, y,
          elements: document.elementsFromPoint(x, y).slice(0, 12).map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const before = getComputedStyle(element, '::before');
            const after = getComputedStyle(element, '::after');
            return {
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              classes: typeof element.className === 'string' ? element.className.slice(0, 240) : null,
              text: (element.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
              backgroundColor: style.backgroundColor,
              parent: element.parentElement ? {
                id: element.parentElement.id || null,
                classes: typeof element.parentElement.className === 'string' ? element.parentElement.className.slice(0, 240) : null,
              } : null,
              previous: element.previousElementSibling ? {
                id: element.previousElementSibling.id || null,
                classes: typeof element.previousElementSibling.className === 'string' ? element.previousElementSibling.className.slice(0, 240) : null,
              } : null,
              next: element.nextElementSibling ? {
                id: element.nextElementSibling.id || null,
                classes: typeof element.nextElementSibling.className === 'string' ? element.nextElementSibling.className.slice(0, 240) : null,
              } : null,
              before: { content: before.content, backgroundColor: before.backgroundColor, display: before.display },
              after: {
                content: after.content,
                backgroundColor: after.backgroundColor,
                display: after.display,
                position: after.position,
                top: after.top, right: after.right, bottom: after.bottom, left: after.left,
                width: after.width, height: after.height,
                transform: after.transform,
                zIndex: after.zIndex,
                opacity: after.opacity,
                visibility: after.visibility,
              },
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            };
          }),
        }));
        return { href: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, elements: items.slice(0, 220), hits };
      })()`);
      reports.push({ targetId: target.id, ...elements });
    } catch (error) {
      reports.push({ targetId: target.id, url: target.url, error: error.message });
    } finally {
      client.close();
    }
  }
  console.log(JSON.stringify({ ok: reports.length > 0, browserId: identity.id, reports }, null, 2));
  if (!reports.length) process.exitCode = 2;
}

async function runInspectTargets(options) {
  const identity = await getBrowserIdentity(options.port);
  const version = await httpGetJson(options.port, "/json/version", 2500);
  const browser = await new CdpClient(version.webSocketDebuggerUrl, options.port, 12000).connect();
  try {
    const result = await browser.send("Target.getTargets");
    const targets = (result.targetInfos || []).map((target) => ({
      targetId: target.targetId,
      type: target.type,
      title: target.title,
      url: target.url,
      attached: target.attached,
      openerId: target.openerId || null,
      browserContextId: target.browserContextId || null,
      canAccessOpener: target.canAccessOpener,
    }));
    console.log(JSON.stringify({ ok: true, browserId: identity.id, targets }, null, 2));
  } finally {
    browser.close();
  }
}

async function runSelfTest(options) {
  const loaded = await loadPayload(options.themePath);
  if (!loaded.payload.includes("doubao-dream-skin-background")) throw new Error("Payload is missing its background marker");
  if (!loaded.payload.includes("data:image/")) throw new Error("Payload is missing its embedded background image");
  if (!loaded.payload.includes("--dbs-main-text")) throw new Error("Payload is missing adaptive text colors");
  if (!["auto", "dark", "light", "custom"].includes(loaded.theme.textColorMode)) throw new Error("Text color mode was not normalized");
  const frame = encodeClientFrame(0x1, Buffer.from("self-test", "utf8"));
  if (!(frame[1] & 0x80)) throw new Error("Client WebSocket frames must be masked");
  console.log(JSON.stringify({
    ok: true,
    version: VERSION,
    theme: loaded.theme.name,
    image: path.relative(PROJECT_ROOT, loaded.imagePath),
    payloadBytes: Buffer.byteLength(loaded.payload, "utf8"),
  }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "self-test") await runSelfTest(options);
  else if (options.mode === "watch") await runWatch(options);
  else if (options.mode === "once") await runOnce(options);
  else if (options.mode === "verify") await runVerify(options);
  else if (options.mode === "remove") await runRemove(options);
  else if (options.mode === "inspect") await runInspect(options);
  else if (options.mode === "inspect-targets") await runInspectTargets(options);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
