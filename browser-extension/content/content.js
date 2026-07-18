(() => {
  "use strict";

  const INSTANCE_KEY = "__doubaoDreamSkinWebLoaded";
  if (globalThis[INSTANCE_KEY]) return;
  globalThis[INSTANCE_KEY] = true;

  const shared = globalThis.DoubaoDreamSkinShared;
  const colorEngine = globalThis.DoubaoDreamSkinColor;
  if (!shared || !colorEngine) return;

  const MARKER = "doubaoDreamSkinWeb";
  const BACKGROUND_ID = "doubao-dream-skin-web-background";
  const DEFAULT_BACKGROUND = [
    "radial-gradient(circle at 24% 24%, rgba(255, 238, 205, 0.96), rgba(246, 169, 140, 0) 42%)",
    "radial-gradient(circle at 78% 74%, rgba(160, 228, 219, 0.92), rgba(134, 196, 207, 0) 46%)",
    "linear-gradient(135deg, #f8d7c6 0%, #d7d5ef 48%, #a9d8df 100%)",
  ].join(", ");

  let currentConfig = shared.normalizeConfig(shared.DEFAULT_CONFIG);
  let hostObserver = null;
  let analysisVersion = 0;

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
    analysisVersion += 1;
    hostObserver?.disconnect();
    hostObserver = null;
    delete document.documentElement.dataset[MARKER];
    delete document.documentElement.dataset.doubaoDreamSkinText;
    delete document.documentElement.dataset.doubaoDreamSkinStyle;
    document.getElementById(BACKGROUND_ID)?.remove();
    [
      "--dbsw-sidebar",
      "--dbsw-surface",
      "--dbsw-composer",
      "--dbsw-border",
      "--dbsw-shadow",
      "--dbsw-overlay",
      "--dbsw-blur",
      "--dbsw-sidebar-text",
      "--dbsw-sidebar-muted",
      "--dbsw-main-text",
      "--dbsw-main-muted",
      "--dbsw-composer-text",
      "--dbsw-composer-muted",
      "--dbsw-sidebar-text-shadow",
      "--dbsw-main-text-shadow",
      "--dbsw-composer-text-shadow",
      "--dbsw-color-scheme",
      "--dbsw-accent",
      "--dbsw-accent-ink",
      "--dbsw-accent-soft",
      "--dbsw-card",
      "--dbsw-user-bubble",
      "--dbsw-assistant-bubble",
      "--dbsw-radius",
      "--dbsw-radius-sm",
      "--dbsw-elevation",
    ].forEach((name) => document.documentElement.style.removeProperty(name));
  }

  function applyTextPalette(palette) {
    const root = document.documentElement;
    setVariable("--dbsw-sidebar-text", palette.sidebar.primary);
    setVariable("--dbsw-sidebar-muted", palette.sidebar.muted);
    setVariable("--dbsw-main-text", palette.main.primary);
    setVariable("--dbsw-main-muted", palette.main.muted);
    setVariable("--dbsw-composer-text", palette.composer.primary);
    setVariable("--dbsw-composer-muted", palette.composer.muted);
    setVariable("--dbsw-sidebar-text-shadow", palette.sidebar.shadow);
    setVariable("--dbsw-main-text-shadow", palette.main.shadow);
    setVariable("--dbsw-composer-text-shadow", palette.composer.shadow);
    setVariable("--dbsw-color-scheme", palette.main.tone === "light" ? "dark" : "light");
    root.dataset.doubaoDreamSkinText = [
      `sidebar-${palette.sidebar.tone}`,
      `main-${palette.main.tone}`,
      `composer-${palette.composer.tone}`,
    ].join(" ");
  }

  function updateTextPalette() {
    const version = ++analysisVersion;
    applyTextPalette(colorEngine.resolvePalette(currentConfig));
    if (!currentConfig.backgroundImage) return;
    colorEngine.analyzeImage(currentConfig.backgroundImage).then((profile) => {
      if (version !== analysisVersion || !currentConfig.enabled) return;
      applyTextPalette(colorEngine.resolvePalette(currentConfig, profile));
    });
  }

  function applyConfig(value) {
    currentConfig = shared.normalizeConfig(value);
    if (!currentConfig.enabled) {
      removeSkin();
      return;
    }

    document.documentElement.dataset[MARKER] = "enabled";
    document.documentElement.dataset.doubaoDreamSkinStyle = currentConfig.componentStyle;
    setVariable("--dbsw-sidebar", shared.hexToRgba(currentConfig.sidebarColor, currentConfig.sidebarAlpha));
    setVariable("--dbsw-surface", shared.hexToRgba(currentConfig.surfaceColor, currentConfig.surfaceAlpha));
    setVariable("--dbsw-composer", shared.hexToRgba(currentConfig.composerColor, currentConfig.composerAlpha));
    setVariable("--dbsw-border", shared.hexToRgba(currentConfig.accentColor, currentConfig.componentStyle === "outline" ? 34 : 20));
    setVariable("--dbsw-shadow", `rgba(15, 23, 42, ${(currentConfig.shadowStrength / 100).toFixed(2)})`);
    setVariable("--dbsw-overlay", "rgba(28, 18, 16, 0.08)");
    setVariable("--dbsw-blur", `${currentConfig.blurPixels}px`);
    setVariable("--dbsw-accent", currentConfig.accentColor);
    setVariable("--dbsw-accent-ink", currentConfig.accentTextColor);
    setVariable("--dbsw-accent-soft", shared.hexToRgba(currentConfig.accentColor, currentConfig.componentStyle === "solid" ? 28 : 16));
    setVariable("--dbsw-card", shared.hexToRgba(currentConfig.cardColor, currentConfig.cardAlpha));
    setVariable("--dbsw-user-bubble", shared.hexToRgba(currentConfig.userBubbleColor, currentConfig.userBubbleAlpha));
    setVariable("--dbsw-assistant-bubble", shared.hexToRgba(currentConfig.assistantBubbleColor, currentConfig.assistantBubbleAlpha));
    setVariable("--dbsw-radius", `${currentConfig.cornerRadius}px`);
    setVariable("--dbsw-radius-sm", `${Math.max(6, Math.round(currentConfig.cornerRadius * 0.62))}px`);
    setVariable("--dbsw-elevation", `0 12px 36px rgba(15, 23, 42, ${(currentConfig.shadowStrength / 100).toFixed(2)})`);
    updateTextPalette();
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
