(() => {
  "use strict";

  const DARK_TEXT = Object.freeze({ primary: "#1f2329", muted: "#59636f", rgb: [31, 35, 41] });
  const LIGHT_TEXT = Object.freeze({ primary: "#f7f8fa", muted: "#d7dce2", rgb: [247, 248, 250] });
  const DEFAULT_PROFILE = Object.freeze({
    sidebar: [[244, 220, 207], [217, 215, 235], [237, 229, 220]],
    main: [[217, 215, 235], [169, 216, 223], [248, 215, 198], [225, 227, 235]],
    composer: [[231, 224, 226], [184, 214, 222], [242, 225, 214]],
  });

  const clamp = (value, minimum = 0, maximum = 255) => Math.max(minimum, Math.min(maximum, Number(value)));

  function hexToRgb(value, fallback = [255, 255, 255]) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return [...fallback];
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ];
  }

  function relativeLuminance(rgb) {
    const linear = rgb.map((value) => {
      const channel = clamp(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function contrastRatio(first, second) {
    const firstLuma = relativeLuminance(first);
    const secondLuma = relativeLuminance(second);
    return (Math.max(firstLuma, secondLuma) + 0.05) / (Math.min(firstLuma, secondLuma) + 0.05);
  }

  function composite(foreground, alpha, background) {
    const amount = clamp(alpha, 0, 1);
    return foreground.map((value, index) => clamp(value * amount + background[index] * (1 - amount)));
  }

  function percentile(values, ratio) {
    if (!values.length) return 1;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
  }

  function effectiveSamples(samples, panelColor, panelAlpha, brightness) {
    const source = Array.isArray(samples) && samples.length ? samples : DEFAULT_PROFILE.main;
    const multiplier = clamp(brightness, 50, 130) / 100;
    return source.map((sample) => {
      const filtered = sample.map((channel) => clamp(channel * multiplier));
      const overlaid = composite([28, 18, 16], 0.08, filtered);
      return composite(panelColor, clamp(panelAlpha, 0, 100) / 100, overlaid);
    });
  }

  function evaluateCandidate(samples, candidate) {
    const contrasts = samples.map((background) => contrastRatio(candidate.rgb, background));
    const average = contrasts.reduce((total, value) => total + value, 0) / contrasts.length;
    const passRatio = contrasts.filter((value) => value >= 4.5).length / contrasts.length;
    const low = percentile(contrasts, 0.2);
    return {
      ...candidate,
      averageContrast: average,
      lowContrast: low,
      score: passRatio * 8 + low * 0.8 + average * 0.45,
    };
  }

  function shadowFor(candidate) {
    if (candidate.lowContrast >= 4.5) return "none";
    if (candidate.tone === "light") {
      return candidate.lowContrast < 3.2 ? "0 1px 3px rgba(0, 0, 0, 0.78)" : "0 1px 2px rgba(0, 0, 0, 0.52)";
    }
    return candidate.lowContrast < 3.2 ? "0 1px 3px rgba(255, 255, 255, 0.72)" : "0 1px 2px rgba(255, 255, 255, 0.42)";
  }

  function resolveRegion(samples, panelColor, panelAlpha, config, forced) {
    const backgrounds = effectiveSamples(samples, panelColor, panelAlpha, config.backgroundBrightness);
    let selected;
    if (forced) {
      selected = evaluateCandidate(backgrounds, forced);
    } else {
      const dark = evaluateCandidate(backgrounds, { ...DARK_TEXT, tone: "dark" });
      const light = evaluateCandidate(backgrounds, { ...LIGHT_TEXT, tone: "light" });
      selected = dark.score >= light.score ? dark : light;
    }
    return {
      primary: selected.primary,
      muted: selected.muted,
      tone: selected.tone,
      contrast: Number(selected.averageContrast.toFixed(2)),
      lowContrast: Number(selected.lowContrast.toFixed(2)),
      shadow: shadowFor(selected),
    };
  }

  function resolvePalette(config, profile = DEFAULT_PROFILE) {
    const mode = ["auto", "dark", "light", "custom"].includes(config.textColorMode)
      ? config.textColorMode
      : "auto";
    let forced = null;
    if (mode === "dark") forced = { ...DARK_TEXT, tone: "dark" };
    if (mode === "light") forced = { ...LIGHT_TEXT, tone: "light" };
    if (mode === "custom") {
      const rgb = hexToRgb(config.textColor, DARK_TEXT.rgb);
      forced = {
        primary: config.textColor,
        muted: config.mutedTextColor,
        rgb,
        tone: relativeLuminance(rgb) >= 0.52 ? "light" : "dark",
      };
    }

    const sidebar = resolveRegion(
      profile.sidebar,
      hexToRgb(config.sidebarColor),
      config.sidebarAlpha,
      config,
      forced,
    );
    const main = resolveRegion(
      profile.main,
      hexToRgb(config.surfaceColor),
      config.surfaceAlpha,
      config,
      forced,
    );
    const composer = resolveRegion(
      profile.composer,
      hexToRgb(config.composerColor),
      config.composerAlpha,
      config,
      forced,
    );
    return { mode, sidebar, main, composer };
  }

  function analyzeImage(dataUrl) {
    if (!dataUrl || typeof Image !== "function") return Promise.resolve(DEFAULT_PROFILE);
    return new Promise((resolve) => {
      const image = new Image();
      image.addEventListener("load", () => {
        try {
          const width = 72;
          const height = Math.max(24, Math.min(72, Math.round(width * image.naturalHeight / Math.max(1, image.naturalWidth))));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Canvas is unavailable");
          context.drawImage(image, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data;
          const all = [];
          const sidebar = [];
          const main = [];
          const composer = [];
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset + 3] < 96) continue;
            const index = offset / 4;
            const x = (index % width) / Math.max(1, width - 1);
            const y = Math.floor(index / width) / Math.max(1, height - 1);
            const sample = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
            all.push(sample);
            if (x <= 0.24) sidebar.push(sample);
            if (x >= 0.16) main.push(sample);
            if (x >= 0.2 && y >= 0.68) composer.push(sample);
          }
          if (!all.length) throw new Error("Image contains no opaque pixels");
          resolve({
            sidebar: sidebar.length ? sidebar : all,
            main: main.length ? main : all,
            composer: composer.length ? composer : all,
          });
        } catch (_) {
          resolve(DEFAULT_PROFILE);
        }
      }, { once: true });
      image.addEventListener("error", () => resolve(DEFAULT_PROFILE), { once: true });
      image.src = dataUrl;
    });
  }

  globalThis.DoubaoDreamSkinColor = Object.freeze({
    DEFAULT_PROFILE,
    analyzeImage,
    contrastRatio,
    hexToRgb,
    relativeLuminance,
    resolvePalette,
  });
})();
