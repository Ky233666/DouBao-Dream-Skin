(() => {
  const VERSION = __DBS_VERSION_JSON__;
  const FINGERPRINT = __DBS_FINGERPRINT_JSON__;
  const CSS_TEXT = __DBS_CSS_JSON__;
  const BACKGROUND_DATA_URL = __DBS_BACKGROUND_JSON__;
  const THEME = __DBS_THEME_JSON__;
  const STYLE_ID = "doubao-dream-skin-style";
  const BACKGROUND_ID = "doubao-dream-skin-background";

  const oldState = window.__doubaoDreamSkin;
  if (oldState && oldState.fingerprint === FINGERPRINT) {
    oldState.ensure?.();
    return {
      ok: true,
      reused: true,
      version: oldState.version,
      href: location.href,
      title: document.title,
    };
  }

  try {
    oldState?.cleanup?.();
  } catch (_) {
    // A stale skin must never prevent the new one from being applied.
  }

  let observer = null;

  const setVariables = () => {
    const root = document.documentElement;
    root.dataset.doubaoDreamSkin = VERSION;
    root.style.setProperty("--dbs-sidebar", THEME.sidebarColor);
    root.style.setProperty("--dbs-surface", THEME.surfaceColor);
    root.style.setProperty("--dbs-composer", THEME.composerColor);
    root.style.setProperty("--dbs-border", THEME.borderColor);
    root.style.setProperty("--dbs-shadow", THEME.shadowColor);
    root.style.setProperty("--dbs-accent", THEME.accentColor);
    root.style.setProperty("--dbs-overlay", THEME.overlayColor);
    root.style.setProperty("--dbs-blur", `${THEME.blurPixels}px`);
  };

  const ensure = () => {
    setVariables();

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.dataset.owner = "doubao-dream-skin";
      style.textContent = CSS_TEXT;
      (document.head || document.documentElement).appendChild(style);
    }

    if (document.body && !document.getElementById(BACKGROUND_ID)) {
      const background = document.createElement("div");
      background.id = BACKGROUND_ID;
      background.setAttribute("aria-hidden", "true");
      background.dataset.owner = "doubao-dream-skin";
      background.style.backgroundImage = `url("${BACKGROUND_DATA_URL}")`;
      background.style.backgroundPosition = THEME.backgroundPosition;
      background.style.filter = `brightness(${THEME.backgroundBrightness}) saturate(${THEME.backgroundSaturation})`;
      document.body.prepend(background);
    }
  };

  const cleanup = () => {
    observer?.disconnect();
    observer = null;
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(BACKGROUND_ID)?.remove();
    const root = document.documentElement;
    delete root.dataset.doubaoDreamSkin;
    for (const property of [
      "--dbs-sidebar",
      "--dbs-surface",
      "--dbs-composer",
      "--dbs-border",
      "--dbs-shadow",
      "--dbs-accent",
      "--dbs-overlay",
      "--dbs-blur",
    ]) {
      root.style.removeProperty(property);
    }
    if (window.__doubaoDreamSkin?.fingerprint === FINGERPRINT) {
      delete window.__doubaoDreamSkin;
    }
    return true;
  };

  ensure();
  observer = new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID) || (document.body && !document.getElementById(BACKGROUND_ID))) {
      ensure();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.__doubaoDreamSkin = {
    version: VERSION,
    fingerprint: FINGERPRINT,
    ensure,
    cleanup,
  };

  return {
    ok: true,
    reused: false,
    version: VERSION,
    href: location.href,
    title: document.title,
  };
})();
