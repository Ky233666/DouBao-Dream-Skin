(() => {
  "use strict";

  const INSTANCE_KEY = "__doubaoDreamSkinWebLoaded";
  if (globalThis[INSTANCE_KEY]) return;
  globalThis[INSTANCE_KEY] = true;

  const shared = globalThis.DoubaoDreamSkinShared;
  if (!shared) return;

  const MARKER = "doubaoDreamSkinWeb";
  const BACKGROUND_ID = "doubao-dream-skin-web-background";
  const DEFAULT_BACKGROUND = [
    "radial-gradient(circle at 24% 24%, rgba(255, 238, 205, 0.96), rgba(246, 169, 140, 0) 42%)",
    "radial-gradient(circle at 78% 74%, rgba(160, 228, 219, 0.92), rgba(134, 196, 207, 0) 46%)",
    "linear-gradient(135deg, #f8d7c6 0%, #d7d5ef 48%, #a9d8df 100%)",
  ].join(", ");

  let currentConfig = shared.normalizeConfig(shared.DEFAULT_CONFIG);
  let hostObserver = null;

  const setVariable = (name, value) => document.documentElement.style.setProperty(name, value);

  function ensureBackground() {
    if (!currentConfig.enabled) return;
    const host = document.body || document.documentElement;
    let background = document.getElementById(BACKGROUND_ID);
    if (!background) {
      background = document.createElement("div");
      background.id = BACKGROUND_ID;
      background.setAttribute("aria-hidden", "true");
      background.dataset.owner = "doubao-dream-skin-extension";
    }
    if (background.parentElement !== host) host.prepend(background);
    background.style.backgroundImage = currentConfig.backgroundImage
      ? `url("${currentConfig.backgroundImage}")`
      : DEFAULT_BACKGROUND;
    background.style.backgroundPosition = currentConfig.backgroundPosition;
    background.style.filter = `brightness(${currentConfig.backgroundBrightness / 100}) saturate(${currentConfig.backgroundSaturation / 100})`;
  }

  function observeBackgroundHost() {
    if (hostObserver) hostObserver.disconnect();
    const host = document.body || document.documentElement;
    hostObserver = new MutationObserver(() => {
      if (currentConfig.enabled && !document.getElementById(BACKGROUND_ID)) ensureBackground();
      if (document.body && host !== document.body) observeBackgroundHost();
    });
    hostObserver.observe(host, { childList: true });
  }

  function removeSkin() {
    delete document.documentElement.dataset[MARKER];
    document.getElementById(BACKGROUND_ID)?.remove();
    [
      "--dbsw-sidebar",
      "--dbsw-surface",
      "--dbsw-composer",
      "--dbsw-border",
      "--dbsw-shadow",
      "--dbsw-overlay",
      "--dbsw-blur",
    ].forEach((name) => document.documentElement.style.removeProperty(name));
  }

  function applyConfig(value) {
    currentConfig = shared.normalizeConfig(value);
    if (!currentConfig.enabled) {
      removeSkin();
      return;
    }

    document.documentElement.dataset[MARKER] = "enabled";
    setVariable("--dbsw-sidebar", shared.hexToRgba(currentConfig.sidebarColor, currentConfig.sidebarAlpha));
    setVariable("--dbsw-surface", shared.hexToRgba(currentConfig.surfaceColor, currentConfig.surfaceAlpha));
    setVariable("--dbsw-composer", shared.hexToRgba(currentConfig.composerColor, currentConfig.composerAlpha));
    setVariable("--dbsw-border", "rgba(80, 57, 50, 0.18)");
    setVariable("--dbsw-shadow", "rgba(48, 28, 22, 0.18)");
    setVariable("--dbsw-overlay", "rgba(28, 18, 16, 0.08)");
    setVariable("--dbsw-blur", `${currentConfig.blurPixels}px`);
    ensureBackground();
    observeBackgroundHost();
  }

  applyConfig(shared.DEFAULT_CONFIG);

  chrome.storage.local.get(shared.STORAGE_KEY, (result) => {
    if (chrome.runtime.lastError) return;
    applyConfig(result[shared.STORAGE_KEY] || shared.DEFAULT_CONFIG);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[shared.STORAGE_KEY]) return;
    applyConfig(changes[shared.STORAGE_KEY].newValue || shared.DEFAULT_CONFIG);
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (currentConfig.enabled) ensureBackground();
    observeBackgroundHost();
  }, { once: true });
})();
