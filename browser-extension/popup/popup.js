(() => {
  "use strict";

  const shared = globalThis.DoubaoDreamSkinShared;
  const enabled = document.getElementById("enabled");
  const stateText = document.getElementById("stateText");
  const openOptions = document.getElementById("openOptions");
  const reset = document.getElementById("reset");
  let current = shared.normalizeConfig(shared.DEFAULT_CONFIG);

  const render = () => {
    enabled.checked = current.enabled;
    stateText.textContent = current.enabled ? "已开启，刷新页面也会保留" : "已暂停，网页恢复原外观";
  };

  const save = () => {
    chrome.storage.local.set({ [shared.STORAGE_KEY]: current }, () => {
      if (chrome.runtime.lastError) stateText.textContent = "保存失败，请重试";
    });
  };

  chrome.storage.local.get(shared.STORAGE_KEY, (result) => {
    current = shared.normalizeConfig(result[shared.STORAGE_KEY] || shared.DEFAULT_CONFIG);
    render();
  });

  enabled.addEventListener("change", () => {
    current = { ...current, enabled: enabled.checked };
    render();
    save();
  });

  openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

  reset.addEventListener("click", () => {
    if (!confirm("恢复默认渐变背景和推荐玻璃参数？")) return;
    current = shared.normalizeConfig(shared.DEFAULT_CONFIG);
    render();
    save();
  });
})();
