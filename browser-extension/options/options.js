(() => {
  "use strict";

  const shared = globalThis.DoubaoDreamSkinShared;
  const byId = (id) => document.getElementById(id);
  const preview = byId("preview");
  const status = byId("status");
  const imageInput = byId("imageInput");
  let pendingImage = null;
  let pendingFileName = shared.DEFAULT_CONFIG.backgroundFileName;

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
  rangeFields.forEach(([id, suffix]) => byId(id).addEventListener("input", () => updateOutput(id, suffix)));

  function updatePreview() {
    preview.style.backgroundImage = pendingImage ? `url("${pendingImage}")` : defaultBackground;
    preview.style.backgroundPosition = byId("backgroundPosition").value;
    preview.style.filter = `brightness(${Number(byId("backgroundBrightness").value) / 100}) saturate(${Number(byId("backgroundSaturation").value) / 100})`;
    byId("backgroundName").textContent = pendingFileName;
  }

  ["backgroundPosition", "backgroundBrightness", "backgroundSaturation"].forEach((id) => {
    byId(id).addEventListener("input", updatePreview);
  });

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
    pendingImage = normalized.backgroundImage;
    pendingFileName = normalized.backgroundFileName;
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
    });
  }

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
