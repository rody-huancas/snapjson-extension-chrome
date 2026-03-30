const MAX_HISTORY = 20;

/**
 * Lee el estado persistido del panel.
 * @returns {Promise<{panelTabId: number|null, panelOpen: boolean, panelWindowId: number|null}>}
 */
const getPanelState = async () => {
  const data = await chrome.storage.local.get([
    "panelTabId",
    "panelOpen",
    "panelWindowId"
  ]);
  return {
    panelTabId: Number.isInteger(data.panelTabId) ? data.panelTabId : null,
    panelOpen: data.panelOpen === true,
    panelWindowId: Number.isInteger(data.panelWindowId)
      ? data.panelWindowId
      : null
  };
};

/**
 * Guarda el tab y ventana donde esta abierto el panel.
 * @param {number} panelTabId
 * @param {number} panelWindowId
 * @returns {Promise<void>}
 */
const setPanelState = async (panelTabId, panelWindowId) => {
  await chrome.storage.local.set({
    panelTabId,
    panelWindowId,
    panelOpen: true
  });
};

/**
 * Reinyecta el content script si la pagina aun no esta parcheada.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
const reInjectIfNeeded = async (tabId) => {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__snapJsonFetchPatchedVersion === "2",
    });
    if (result) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content/bridge.js"],
    });
  } catch (_) {}
};

/**
 * Agrega una captura al historial.
 * @param {object} payload
 * @returns {Promise<void>}
 */
const addToHistory = async (payload) => {
  const data = await chrome.storage.local.get("history");
  const history = Array.isArray(data.history) ? data.history : [];
  const next = [payload, ...history].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ history: next });
};

/**
 * Devuelve si una URL pertenece a un dominio excluido.
 * @param {string} url
 * @param {Array} excluded
 * @param {string} baseUrl
 * @returns {boolean}
 */
const isExcluded = (url, excluded, baseUrl) => {
  if (!url || !Array.isArray(excluded) || excluded.length === 0) return false;
  try {
    const host = new URL(url, baseUrl).hostname;
    return excluded.some((domain) => {
      const normalized = String(domain)
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")
        .split("/")[0];
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
};

// Al hacer clic en el icono: guardar que tab abrio el panel
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await setPanelState(tab.id, tab.windowId);
  await reInjectIfNeeded(tab.id);
});

// Cuando el usuario cambia de tab, actualizar panelTabId si el panel sigue abierto
chrome.tabs.onActivated.addListener(({ tabId }) => {
  getPanelState().then(async ({ panelOpen, panelWindowId }) => {
    if (!panelOpen || panelWindowId === null) return;
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== panelWindowId) return;
    chrome.storage.local.set({ panelTabId: tabId });
  });
});

// Limpiar historial cuando el tab navega
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  const { panelTabId } = await getPanelState();
  if (panelTabId !== tabId) return;
  await chrome.storage.local.set({ history: [] });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PANEL_READY") {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return sendResponse({ ok: false });
      setPanelState(tab.id, tab.windowId).then(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (message?.type !== "JSON_CAPTURED") return;

  const senderTabId = sender.tab?.id ?? null;
  getPanelState()
    .then(async ({ panelTabId }) => {
      if (panelTabId === null || senderTabId !== panelTabId) {
        sendResponse({ ok: true, ignored: true });
        return;
      }

      if (!sender.tab?.url) {
        sendResponse({ ok: true, ignored: true });
        return;
      }

      const state = await chrome.storage.local.get([
        "pausedTabs",
        "excludedDomains",
      ]);
      const pausedTabs = Array.isArray(state.pausedTabs) ? state.pausedTabs : [];
      if (pausedTabs.includes(senderTabId)) {
        sendResponse({ ok: true, ignored: true, paused: true });
        return;
      }

      const pageUrl = sender.tab.url;
      const requestUrl = message.url
        ? new URL(message.url, pageUrl).toString()
        : "";
      const pageOrigin = new URL(pageUrl).origin + "/";
      const excluded = state.excludedDomains;

      if (
        isExcluded(requestUrl, excluded, pageUrl) ||
        isExcluded(pageUrl, excluded, pageUrl)
      ) {
        sendResponse({ ok: true, ignored: true, excluded: true });
        return;
      }

      const payload = {
        id: Date.now(),
        tabId: senderTabId,
        url: requestUrl || pageUrl,
        pageUrl,
        pageOrigin,
        pageTitle: sender.tab?.title || "",
        method: String(message.method || "GET").toUpperCase(),
        status: message.status || 0,
        duration: message.duration || 0,
        json: JSON.stringify(message.data, null, 2),
        createdAt: Date.now(),
      };

      addToHistory(payload)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "TOGGLE_PAUSE" && message?.type !== "GET_PAUSE_STATE") return;

  getPanelState()
    .then(async ({ panelTabId }) => {
      let activeTabId = panelTabId;
      if (!activeTabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return sendResponse({ ok: false });
        await setPanelState(tab.id, tab.windowId);
        activeTabId = tab.id;
      }

      const data = await chrome.storage.local.get("pausedTabs");
      const pausedTabs = Array.isArray(data.pausedTabs) ? data.pausedTabs : [];

      if (message.type === "GET_PAUSE_STATE") {
        return sendResponse({ ok: true, paused: pausedTabs.includes(activeTabId) });
      }

      const nextPaused = pausedTabs.includes(activeTabId)
        ? pausedTabs.filter((id) => id !== activeTabId)
        : [activeTabId, ...pausedTabs];

      await chrome.storage.local.set({ pausedTabs: nextPaused });
      sendResponse({ ok: true, paused: nextPaused.includes(activeTabId) });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
