(() => {
  "use strict";

  const STORAGE_KEY = "doubaoDreamSkinConfig";
  const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  const MAX_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 1.38) + 128;

  const THEME_PRESETS = Object.freeze({
    "warm-glass": Object.freeze({
      id: "warm-glass",
      name: "暖霞玻璃",
      description: "温暖柔和，适合人像与暖色壁纸",
      values: Object.freeze({
        componentStyle: "soft",
        sidebarColor: "#fff1e8", sidebarAlpha: 48,
        surfaceColor: "#fffaf6", surfaceAlpha: 35,
        composerColor: "#fffcf9", composerAlpha: 82,
        accentColor: "#b85f4b", accentTextColor: "#fffaf8",
        cardColor: "#fffaf6", cardAlpha: 62,
        userBubbleColor: "#b85f4b", userBubbleAlpha: 88,
        assistantBubbleColor: "#ffffff", assistantBubbleAlpha: 62,
        cornerRadius: 18, shadowStrength: 18,
      }),
    }),
    "midnight-neon": Object.freeze({
      id: "midnight-neon",
      name: "午夜霓虹",
      description: "深色玻璃配青色高光，适合游戏与夜景壁纸",
      values: Object.freeze({
        componentStyle: "solid",
        sidebarColor: "#111827", sidebarAlpha: 74,
        surfaceColor: "#0f172a", surfaceAlpha: 52,
        composerColor: "#111827", composerAlpha: 90,
        accentColor: "#22d3ee", accentTextColor: "#06242b",
        cardColor: "#172033", cardAlpha: 82,
        userBubbleColor: "#155e75", userBubbleAlpha: 94,
        assistantBubbleColor: "#1e293b", assistantBubbleAlpha: 86,
        cornerRadius: 20, shadowStrength: 34,
      }),
    }),
    "sakura-dream": Object.freeze({
      id: "sakura-dream",
      name: "樱花梦境",
      description: "粉紫色组件与柔和圆角，适合动漫和花卉壁纸",
      values: Object.freeze({
        componentStyle: "soft",
        sidebarColor: "#fff0f6", sidebarAlpha: 58,
        surfaceColor: "#fff7fb", surfaceAlpha: 42,
        composerColor: "#fff9fc", composerAlpha: 88,
        accentColor: "#e85d8e", accentTextColor: "#ffffff",
        cardColor: "#fff0f7", cardAlpha: 72,
        userBubbleColor: "#e85d8e", userBubbleAlpha: 88,
        assistantBubbleColor: "#fff7fb", assistantBubbleAlpha: 78,
        cornerRadius: 22, shadowStrength: 20,
      }),
    }),
    "ocean-breeze": Object.freeze({
      id: "ocean-breeze",
      name: "海盐微风",
      description: "清爽蓝绿色组件，适合天空、海洋和浅色壁纸",
      values: Object.freeze({
        componentStyle: "outline",
        sidebarColor: "#e8f7f7", sidebarAlpha: 60,
        surfaceColor: "#f3fbfb", surfaceAlpha: 38,
        composerColor: "#f7fdfd", composerAlpha: 88,
        accentColor: "#147d92", accentTextColor: "#ffffff",
        cardColor: "#eefafa", cardAlpha: 72,
        userBubbleColor: "#147d92", userBubbleAlpha: 86,
        assistantBubbleColor: "#f7fdfd", assistantBubbleAlpha: 78,
        cornerRadius: 16, shadowStrength: 10,
      }),
    }),
  });

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
    themePreset: "warm-glass",
    componentStyle: "soft",
    accentColor: "#b85f4b",
    accentTextColor: "#fffaf8",
    cardColor: "#fffaf6",
    cardAlpha: 62,
    userBubbleColor: "#b85f4b",
    userBubbleAlpha: 88,
    assistantBubbleColor: "#ffffff",
    assistantBubbleAlpha: 62,
    cornerRadius: 18,
    shadowStrength: 18,
    textColorMode: "auto",
    textColor: "#1f2329",
    mutedTextColor: "#59636f",
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
      themePreset: Object.prototype.hasOwnProperty.call(THEME_PRESETS, source.themePreset) || source.themePreset === "custom"
        ? source.themePreset
        : DEFAULT_CONFIG.themePreset,
      componentStyle: ["soft", "outline", "solid"].includes(source.componentStyle)
        ? source.componentStyle
        : DEFAULT_CONFIG.componentStyle,
      accentColor: normalizeHex(source.accentColor, DEFAULT_CONFIG.accentColor),
      accentTextColor: normalizeHex(source.accentTextColor, DEFAULT_CONFIG.accentTextColor),
      cardColor: normalizeHex(source.cardColor, DEFAULT_CONFIG.cardColor),
      cardAlpha: Math.round(clamp(source.cardAlpha, 20, 100, DEFAULT_CONFIG.cardAlpha)),
      userBubbleColor: normalizeHex(source.userBubbleColor, DEFAULT_CONFIG.userBubbleColor),
      userBubbleAlpha: Math.round(clamp(source.userBubbleAlpha, 25, 100, DEFAULT_CONFIG.userBubbleAlpha)),
      assistantBubbleColor: normalizeHex(source.assistantBubbleColor, DEFAULT_CONFIG.assistantBubbleColor),
      assistantBubbleAlpha: Math.round(clamp(source.assistantBubbleAlpha, 20, 100, DEFAULT_CONFIG.assistantBubbleAlpha)),
      cornerRadius: Math.round(clamp(source.cornerRadius, 6, 32, DEFAULT_CONFIG.cornerRadius)),
      shadowStrength: Math.round(clamp(source.shadowStrength, 0, 50, DEFAULT_CONFIG.shadowStrength)),
      textColorMode: ["auto", "dark", "light", "custom"].includes(source.textColorMode)
        ? source.textColorMode
        : DEFAULT_CONFIG.textColorMode,
      textColor: normalizeHex(source.textColor, DEFAULT_CONFIG.textColor),
      mutedTextColor: normalizeHex(source.mutedTextColor, DEFAULT_CONFIG.mutedTextColor),
    };
  }

  function applyPreset(config, presetId) {
    const preset = THEME_PRESETS[presetId];
    if (!preset) return normalizeConfig(config);
    return normalizeConfig({ ...config, ...preset.values, themePreset: preset.id });
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
    THEME_PRESETS,
    DEFAULT_CONFIG,
    normalizeConfig,
    applyPreset,
    hexToRgba,
  });
})();
