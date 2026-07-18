(() => {
  const VERSION = __DBS_VERSION_JSON__;
  const FINGERPRINT = __DBS_FINGERPRINT_JSON__;
  const CSS_TEXT = __DBS_CSS_JSON__;
  const BACKGROUND_DATA_URL = __DBS_BACKGROUND_JSON__;
  const THEME = __DBS_THEME_JSON__;
  const STYLE_ID = "doubao-dream-skin-style";
  const BACKGROUND_ID = "doubao-dream-skin-background";
  const ROOT_VARIABLES = [
    "--dbs-sidebar",
    "--dbs-surface",
    "--dbs-composer",
    "--dbs-border",
    "--dbs-shadow",
    "--dbs-accent",
    "--dbs-overlay",
    "--dbs-blur",
    "--dbs-sidebar-text",
    "--dbs-sidebar-muted",
    "--dbs-main-text",
    "--dbs-main-muted",
    "--dbs-composer-text",
    "--dbs-composer-muted",
    "--dbs-sidebar-text-shadow",
    "--dbs-main-text-shadow",
    "--dbs-composer-text-shadow",
    "--dbs-color-scheme",
    "--dbs-image-luma",
  ];
  const DARK_TEXT = { primary: "#1f2329", muted: "#59636f", rgb: [31, 35, 41], tone: "dark" };
  const LIGHT_TEXT = { primary: "#f7f8fa", muted: "#d7dce2", rgb: [247, 248, 250], tone: "light" };
  const DEFAULT_PROFILE = {
    sidebar: [[244, 220, 207], [217, 215, 235], [237, 229, 220]],
    main: [[217, 215, 235], [169, 216, 223], [248, 215, 198], [225, 227, 235]],
    composer: [[231, 224, 226], [184, 214, 222], [242, 225, 214]],
    luma: 0.72,
  };

  const oldState = window.__doubaoDreamSkin;
  if (oldState && oldState.fingerprint === FINGERPRINT) {
    oldState.ensure?.();
    return {
      ok: true,
      reused: true,
      version: oldState.version,
      href: location.href,
      title: document.title,
      textPalette: oldState.getTextPalette?.() || null,
    };
  }

  try {
    oldState?.cleanup?.();
  } catch (_) {
    // A stale skin must never prevent the new one from being applied.
  }

  let observer = null;
  let active = true;
  let analysisStarted = false;
  let currentProfile = DEFAULT_PROFILE;
  let currentPalette = null;

  const clamp = (value, minimum = 0, maximum = 255) => Math.max(minimum, Math.min(maximum, Number(value)));

  const relativeLuminance = (rgb) => {
    const linear = rgb.map((value) => {
      const channel = clamp(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };

  const contrastRatio = (first, second) => {
    const firstLuma = relativeLuminance(first);
    const secondLuma = relativeLuminance(second);
    return (Math.max(firstLuma, secondLuma) + 0.05) / (Math.min(firstLuma, secondLuma) + 0.05);
  };

  const composite = (foreground, alpha, background) => {
    const amount = clamp(alpha, 0, 1);
    return foreground.map((value, index) => clamp(value * amount + background[index] * (1 - amount)));
  };

  const parseResolvedRgb = (value) => {
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value || "");
    if (!match) return null;
    return [
      clamp(match[1]),
      clamp(match[2]),
      clamp(match[3]),
      match[4] === undefined ? 1 : clamp(match[4], 0, 1),
    ];
  };

  const parseCssColor = (value, fallback) => {
    if (typeof value === "string") {
      const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
      if (hex) {
        return [
          Number.parseInt(hex[1].slice(0, 2), 16),
          Number.parseInt(hex[1].slice(2, 4), 16),
          Number.parseInt(hex[1].slice(4, 6), 16),
          1,
        ];
      }
      const direct = parseResolvedRgb(value.trim());
      if (direct) return direct;
      try {
        const probe = document.createElement("span");
        probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
        probe.style.color = value;
        if (probe.style.color && document.documentElement) {
          document.documentElement.appendChild(probe);
          const resolved = parseResolvedRgb(getComputedStyle(probe).color);
          probe.remove();
          if (resolved) return resolved;
        }
      } catch (_) {}
    }
    return [...fallback];
  };

  const percentile = (values, ratio) => {
    if (!values.length) return 1;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
  };

  const effectiveSamples = (samples, panel, overlay) => {
    const source = Array.isArray(samples) && samples.length ? samples : DEFAULT_PROFILE.main;
    return source.map((sample) => {
      const filtered = sample.map((channel) => clamp(channel * THEME.backgroundBrightness));
      const overlaid = composite(overlay.slice(0, 3), overlay[3], filtered);
      return composite(panel.slice(0, 3), panel[3], overlaid);
    });
  };

  const evaluateCandidate = (backgrounds, candidate) => {
    const contrasts = backgrounds.map((background) => contrastRatio(candidate.rgb, background));
    const average = contrasts.reduce((total, value) => total + value, 0) / contrasts.length;
    const passRatio = contrasts.filter((value) => value >= 4.5).length / contrasts.length;
    const low = percentile(contrasts, 0.2);
    return {
      ...candidate,
      contrast: Number(average.toFixed(2)),
      lowContrast: Number(low.toFixed(2)),
      score: passRatio * 8 + low * 0.8 + average * 0.45,
    };
  };

  const shadowFor = (candidate) => {
    if (candidate.lowContrast >= 4.5) return "none";
    if (candidate.tone === "light") {
      return candidate.lowContrast < 3.2 ? "0 1px 3px rgba(0, 0, 0, 0.78)" : "0 1px 2px rgba(0, 0, 0, 0.52)";
    }
    return candidate.lowContrast < 3.2 ? "0 1px 3px rgba(255, 255, 255, 0.72)" : "0 1px 2px rgba(255, 255, 255, 0.42)";
  };

  const resolveRegion = (samples, panel, overlay, forced) => {
    const backgrounds = effectiveSamples(samples, panel, overlay);
    let selected;
    if (forced) {
      selected = evaluateCandidate(backgrounds, forced);
    } else {
      const dark = evaluateCandidate(backgrounds, DARK_TEXT);
      const light = evaluateCandidate(backgrounds, LIGHT_TEXT);
      selected = dark.score >= light.score ? dark : light;
    }
    return {
      primary: selected.primary,
      muted: selected.muted,
      tone: selected.tone,
      contrast: selected.contrast,
      lowContrast: selected.lowContrast,
      shadow: shadowFor(selected),
    };
  };

  const resolveTextPalette = (profile) => {
    const mode = ["auto", "dark", "light", "custom"].includes(THEME.textColorMode)
      ? THEME.textColorMode
      : "auto";
    let forced = null;
    if (mode === "dark") forced = DARK_TEXT;
    if (mode === "light") forced = LIGHT_TEXT;
    if (mode === "custom") {
      const parsed = parseCssColor(THEME.textColor, [...DARK_TEXT.rgb, 1]);
      forced = {
        primary: THEME.textColor,
        muted: THEME.mutedTextColor,
        rgb: parsed.slice(0, 3),
        tone: relativeLuminance(parsed) >= 0.52 ? "light" : "dark",
      };
    }
    const overlay = parseCssColor(THEME.overlayColor, [28, 18, 16, 0.08]);
    const sidebarPanel = parseCssColor(THEME.sidebarColor, [255, 241, 232, 0.48]);
    const mainPanel = parseCssColor(THEME.surfaceColor, [255, 250, 246, 0.35]);
    const composerPanel = parseCssColor(THEME.composerColor, [255, 252, 249, 0.82]);
    return {
      mode,
      sidebar: resolveRegion(profile.sidebar, sidebarPanel, overlay, forced),
      main: resolveRegion(profile.main, mainPanel, overlay, forced),
      composer: resolveRegion(profile.composer, composerPanel, overlay, forced),
    };
  };

  const analyzeBackground = () => new Promise((resolve) => {
    if (typeof Image !== "function") {
      resolve(DEFAULT_PROFILE);
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const width = 72;
        const height = Math.max(24, Math.min(72, Math.round(width * image.naturalHeight / Math.max(1, image.naturalWidth))));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        const all = [];
        const sidebar = [];
        const main = [];
        const composer = [];
        let totalLuma = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 96) continue;
          const index = offset / 4;
          const x = (index % width) / Math.max(1, width - 1);
          const y = Math.floor(index / width) / Math.max(1, height - 1);
          const sample = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
          all.push(sample);
          totalLuma += relativeLuminance(sample);
          if (x <= 0.24) sidebar.push(sample);
          if (x >= 0.16) main.push(sample);
          if (x >= 0.2 && y >= 0.68) composer.push(sample);
        }
        if (!all.length) throw new Error("Image contains no opaque pixels");
        resolve({
          sidebar: sidebar.length ? sidebar : all,
          main: main.length ? main : all,
          composer: composer.length ? composer : all,
          luma: totalLuma / all.length,
        });
      } catch (_) {
        resolve(DEFAULT_PROFILE);
      }
    };
    image.onerror = () => resolve(DEFAULT_PROFILE);
    image.src = BACKGROUND_DATA_URL;
  });

  const setVariables = () => {
    const root = document.documentElement;
    currentPalette = resolveTextPalette(currentProfile);
    root.dataset.doubaoDreamSkin = VERSION;
    root.dataset.doubaoDreamSkinText = [
      `sidebar-${currentPalette.sidebar.tone}`,
      `main-${currentPalette.main.tone}`,
      `composer-${currentPalette.composer.tone}`,
    ].join(" ");
    root.style.setProperty("--dbs-sidebar", THEME.sidebarColor);
    root.style.setProperty("--dbs-surface", THEME.surfaceColor);
    root.style.setProperty("--dbs-composer", THEME.composerColor);
    root.style.setProperty("--dbs-border", THEME.borderColor);
    root.style.setProperty("--dbs-shadow", THEME.shadowColor);
    root.style.setProperty("--dbs-accent", THEME.accentColor);
    root.style.setProperty("--dbs-overlay", THEME.overlayColor);
    root.style.setProperty("--dbs-blur", `${THEME.blurPixels}px`);
    root.style.setProperty("--dbs-sidebar-text", currentPalette.sidebar.primary);
    root.style.setProperty("--dbs-sidebar-muted", currentPalette.sidebar.muted);
    root.style.setProperty("--dbs-main-text", currentPalette.main.primary);
    root.style.setProperty("--dbs-main-muted", currentPalette.main.muted);
    root.style.setProperty("--dbs-composer-text", currentPalette.composer.primary);
    root.style.setProperty("--dbs-composer-muted", currentPalette.composer.muted);
    root.style.setProperty("--dbs-sidebar-text-shadow", currentPalette.sidebar.shadow);
    root.style.setProperty("--dbs-main-text-shadow", currentPalette.main.shadow);
    root.style.setProperty("--dbs-composer-text-shadow", currentPalette.composer.shadow);
    root.style.setProperty("--dbs-color-scheme", currentPalette.main.tone === "light" ? "dark" : "light");
    root.style.setProperty("--dbs-image-luma", Number(currentProfile.luma || 0.5).toFixed(3));
  };

  const startAnalysis = () => {
    if (analysisStarted) return;
    analysisStarted = true;
    analyzeBackground().then((profile) => {
      if (!active) return;
      currentProfile = profile;
      if (document.documentElement?.dataset?.doubaoDreamSkin) setVariables();
    });
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
    startAnalysis();
  };

  const cleanup = () => {
    active = false;
    observer?.disconnect();
    observer = null;
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(BACKGROUND_ID)?.remove();
    const root = document.documentElement;
    delete root.dataset.doubaoDreamSkin;
    delete root.dataset.doubaoDreamSkinText;
    for (const property of ROOT_VARIABLES) root.style.removeProperty(property);
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
    getTextPalette: () => currentPalette,
  };

  return {
    ok: true,
    reused: false,
    version: VERSION,
    href: location.href,
    title: document.title,
    textPalette: currentPalette,
  };
})();
