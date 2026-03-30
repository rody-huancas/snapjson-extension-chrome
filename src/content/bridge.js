window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "SNAPJSON_FETCH_PATCH" || msg.type !== "JSON_CAPTURED") return;

  try {
    chrome.runtime.sendMessage(
      {
        type    : "JSON_CAPTURED",
        url     : msg.url,
        data    : msg.data,
        method  : msg.method || msg.requestMethod,
        status  : msg.status,
        duration: msg.duration,
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  } catch (_) {}
});

// Inyecta el parche de fetch/XHR en el mundo MAIN
(function injectPatch() {
  const scriptUrl = chrome.runtime.getURL("src/injected/fetch-patch.js");
  const script = document.createElement("script");
  script.src = scriptUrl;
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.addEventListener("load", () => script.remove());
})();
