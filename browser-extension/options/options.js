(() => {
  "use strict";

  const shared = globalThis.DoubaoDreamSkinShared;
  const colorEngine = globalThis.DoubaoDreamSkinColor;
  const byId = (id) => document.getElementById(id);
  const preview = byId("preview");
  const previewBackground = byId("previewBackground");
  const status = byId("status");
  const imageInput = byId("imageInput");
  let pendingImage = null;
  let pendingFileName = shared.DEFAULT_CONFIG.backgroundFileName;
  let previewAnalysisVersion = 0;

  const defaultBackground = [
    "radial-gradient(circle at 24% 24%, rgba(255, 238, 205, 0.96), rgba(246, 169, 140, 0) 42%)",
    "radial-gradient(circle at 78% 74%, rgba(160, 228, 219, 0.92), rgba(134, 196, 207, 0) 46%)",
    "linear-gradient(135deg, #f8d7c6 0%, #d7d5ef 48%, #a9d8df 100%)",
  ].join(", ");

  const rangeFields = [
    ["backgroundBrightness", "%"],
    ["backgroundSaturation", "%"],
    ["blurPixels", " px"],
    ["sidebarAlpha", "%"],
    ["surfaceAlpha", "%"],
    ["composerAlpha", "%"],
  ];

  const updateOutput = (id, suffix) => { byId(`${id}Value`).textContent = `${byId(id).value}${suffix}`; };
  rangeFields.forEach(([id, suffix]) => byId(id).addEventListener("input", () => {
    updateOutput(id, suffix);
    updatePreview();
  }));

  function renderContrast(palette) {
    const container = byId("textAnalysis");
    const labels = [
      ["侧栏", palette.sidebar],
      ["主区域", palette.main],
      ["输入框", palette.composer],
    ];
    const items = labels.map(([label, region]) => {
      const item = document.createElement("div");
      item.className = "contrast-item";
      const swatch = document.createElement("i");
      swatch.className = "contrast-swatch";
      swatch.style.background = region.primary;
      const title = document.createElement("strong");
      title.textContent = label;
      const detail = document.createElement("span");
      detail.textContent = `${region.tone === "light" ? "浅色" : "深色"}文字 · 平均对比度 ${region.contrast}:1`;
      item.append(swatch, title, detail);
      return item;
    });
    container.replaceChildren(...items);
  }

  function applyPreviewPalette(config, palette) {
    preview.style.setProperty("--preview-sidebar", shared.hexToRgba(config.sidebarColor, config.sidebarAlpha));
    preview.style.setProperty("--preview-surface", shared.hexToRgba(config.surfaceColor, config.surfaceAlpha));
    preview.style.setProperty("--preview-composer", shared.hexToRgba(config.composerColor, config.composerAlpha));
    preview.style.setProperty("--preview-sidebar-text", palette.sidebar.primary);
    preview.style.setProperty("--preview-main-text", palette.main.primary);
    preview.style.setProperty("--preview-composer-text", palette.composer.primary);
    preview.style.setProperty("--preview-sidebar-shadow", palette.sidebar.shadow);
    preview.style.setProperty("--preview-main-shadow", palette.main.shadow);
    preview.style.setProperty("--preview-composer-shadow", palette.composer.shadow);
    renderContrast(palette);
  }

  function updateTextControlState() {
    const custom = byId("textColorMode").value === "custom";
    byId("textColor").disabled = !custom;
    byId("mutedTextColor").disabled = !custom;
  }

  function updatePreview() {
    const config = collect();
    const version = ++previewAnalysisVersion;
    previewBackground.style.backgroundImage = pendingImage ? `url("${pendingImage}")` : defaultBackground;
    previewBackground.style.backgroundPosition = config.backgroundPosition;
    previewBackground.style.filter = `brightness(${config.backgroundBrightness / 100}) saturate(${config.backgroundSaturation / 100})`;
    byId("backgroundName").textContent = pendingFileName;
    applyPreviewPalette(config, colorEngine.resolvePalette(config));
    if (pendingImage) {
      colorEngine.analyzeImage(pendingImage).then((profile) => {
        if (version !== previewAnalysisVersion) return;
        applyPreviewPalette(config, colorEngine.resolvePalette(config, profile));
      });
    }
  }

  byId("backgroundPosition").addEventListener("input", updatePreview);

  function render(config) {
    const normalized = shared.normalizeConfig(config);
    byId("enabled").checked = normalized.enabled;
    byId("backgroundPosition").value = normalized.backgroundPosition;
    byId("backgroundBrightness").value = normalized.backgroundBrightness;
    byId("backgroundSaturation").value = normalized.backgroundSaturation;
    byId("blurPixels").value = normalized.blurPixels;
    byId("sidebarColor").value = normalized.sidebarColor;
    byId("sidebarAlpha").value = normalized.sidebarAlpha;
    byId("surfaceColor").value = normalized.surfaceColor;
    byId("surfaceAlpha").value = normalized.surfaceAlpha;
    byId("composerColor").value = normalized.composerColor;
    byId("composerAlpha").value = normalized.composerAlpha;
    byId("textColorMode").value = normalized.textColorMode;
    byId("textColor").value = normalized.textColor;
    byId("mutedTextColor").value = normalized.mutedTextColor;
    pendingImage = normalized.backgroundImage;
    pendingFileName = normalized.backgroundFileName;
    updateTextControlState();
    rangeFields.forEach(([id, suffix]) => updateOutput(id, suffix));
    updatePreview();
  }

  function collect() {
    return shared.normalizeConfig({
      enabled: byId("enabled").checked,
      backgroundImage: pendingImage,
      backgroundFileName: pendingFileName,
      backgroundPosition: byId("backgroundPosition").value,
      backgroundBrightness: byId("backgroundBrightness").value,
      backgroundSaturation: byId("backgroundSaturation").value,
      blurPixels: byId("blurPixels").value,
      sidebarColor: byId("sidebarColor").value,
      sidebarAlpha: byId("sidebarAlpha").value,
      surfaceColor: byId("surfaceColor").value,
      surfaceAlpha: byId("surfaceAlpha").value,
      composerColor: byId("composerColor").value,
      composerAlpha: byId("composerAlpha").value,
      textColorMode: byId("textColorMode").value,
      textColor: byId("textColor").value,
      mutedTextColor: byId("mutedTextColor").value,
    });
  }

  ["sidebarColor", "surfaceColor", "composerColor", "textColor", "mutedTextColor"].forEach((id) => {
    byId(id).addEventListener("input", updatePreview);
  });
  byId("textColorMode").addEventListener("change", () => {
    updateTextControlState();
    updatePreview();
  });

  chrome.storage.local.get(shared.STORAGE_KEY, (result) => {
    render(result[shared.STORAGE_KEY] || shared.DEFAULT_CONFIG);
    chrome.storage.local.getBytesInUse(shared.STORAGE_KEY, (bytes) => {
      if (!chrome.runtime.lastError && bytes > 0) byId("backgroundMeta").textContent = `本机配置占用 ${(bytes / 1024 / 1024).toFixed(2)} MB`;
    });
  });

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp)$/.test(file.type)) {
      status.textContent = "只支持 JPG、PNG 或 WebP 图片";
      imageInput.value = "";
      return;
    }
    if (file.size < 1 || file.size > shared.MAX_IMAGE_BYTES) {
      status.textContent = "图片必须小于 16 MB";
      imageInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      pendingImage = String(reader.result || "");
      pendingFileName = file.name;
      updatePreview();
      status.textContent = "图片已选择，点击保存并应用";
    });
    reader.addEventListener("error", () => { status.textContent = "无法读取这张图片"; });
    reader.readAsDataURL(file);
  });

  byId("removeBackground").addEventListener("click", () => {
    pendingImage = null;
    pendingFileName = shared.DEFAULT_CONFIG.backgroundFileName;
    imageInput.value = "";
    updatePreview();
    status.textContent = "已选择内置背景，点击保存并应用";
  });

  byId("save").addEventListener("click", () => {
    const config = collect();
    chrome.storage.local.set({ [shared.STORAGE_KEY]: config }, () => {
      if (chrome.runtime.lastError) {
        status.textContent = `保存失败：${chrome.runtime.lastError.message}`;
        return;
      }
      status.textContent = "已保存，打开的豆包网页正在自动更新";
      chrome.storage.local.getBytesInUse(shared.STORAGE_KEY, (bytes) => {
        if (!chrome.runtime.lastError) byId("backgroundMeta").textContent = `本机配置占用 ${(bytes / 1024 / 1024).toFixed(2)} MB`;
      });
    });
  });

  byId("reset").addEventListener("click", () => {
    if (!confirm("恢复内置渐变背景和全部推荐参数？")) return;
    render(shared.DEFAULT_CONFIG);
    status.textContent = "推荐参数已载入，点击保存并应用";
  });
})();
