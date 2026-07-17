(() => {
  "use strict";

  const STORAGE_KEY = "doubaoDreamSkinConfig";
  const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  const MAX_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 1.38) + 128;

  const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    backgroundImage: null,
    backgroundFileName: "内置渐变背景",
    backgroundPosition: "center center",
    backgroundBrightness: 100,
    backgroundSaturation: 100,
    blurPixels: 12,
    sidebarColor: "#fff1e8",
    sidebarAlpha: 48,
    surfaceColor: "#fffaf6",
    surfaceAlpha: 35,
    composerColor: "#fffcf9",
    composerAlpha: 82,
  });

  const clamp = (value, minimum, maximum, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  };

  const normalizeHex = (value, fallback) => (
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
  );

  const normalizeImage = (value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > MAX_DATA_URL_LENGTH) return null;
    return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
  };

  function normalizeConfig(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const positions = new Set(["center center", "center top", "40% center", "60% center", "center bottom"]);
    return {
      enabled: source.enabled !== false,
      backgroundImage: normalizeImage(source.backgroundImage),
      backgroundFileName: typeof source.backgroundFileName === "string" && source.backgroundFileName.length <= 180
        ? source.backgroundFileName
        : DEFAULT_CONFIG.backgroundFileName,
      backgroundPosition: positions.has(source.backgroundPosition)
        ? source.backgroundPosition
        : DEFAULT_CONFIG.backgroundPosition,
      backgroundBrightness: Math.round(clamp(source.backgroundBrightness, 50, 130, DEFAULT_CONFIG.backgroundBrightness)),
      backgroundSaturation: Math.round(clamp(source.backgroundSaturation, 0, 200, DEFAULT_CONFIG.backgroundSaturation)),
      blurPixels: Math.round(clamp(source.blurPixels, 0, 60, DEFAULT_CONFIG.blurPixels)),
      sidebarColor: normalizeHex(source.sidebarColor, DEFAULT_CONFIG.sidebarColor),
      sidebarAlpha: Math.round(clamp(source.sidebarAlpha, 15, 100, DEFAULT_CONFIG.sidebarAlpha)),
      surfaceColor: normalizeHex(source.surfaceColor, DEFAULT_CONFIG.surfaceColor),
      surfaceAlpha: Math.round(clamp(source.surfaceAlpha, 0, 100, DEFAULT_CONFIG.surfaceAlpha)),
      composerColor: normalizeHex(source.composerColor, DEFAULT_CONFIG.composerColor),
      composerAlpha: Math.round(clamp(source.composerAlpha, 20, 100, DEFAULT_CONFIG.composerAlpha)),
    };
  }

  function hexToRgba(hex, alphaPercent) {
    const normalized = normalizeHex(hex, "#ffffff");
    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    const alpha = clamp(alphaPercent, 0, 100, 100) / 100;
    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
  }

  globalThis.DoubaoDreamSkinShared = Object.freeze({
    STORAGE_KEY,
    MAX_IMAGE_BYTES,
    DEFAULT_CONFIG,
    normalizeConfig,
    hexToRgba,
  });
})();
