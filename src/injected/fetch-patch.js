(function () {
  const PATCH_VERSION = "2";
  if (window.__snapJsonFetchPatchedVersion === PATCH_VERSION) return;
  window.__snapJsonFetchPatched = true;
  window.__snapJsonFetchPatchedVersion = PATCH_VERSION;

  const notify = (payload) => {
    window.postMessage(
      {
        source: "SNAPJSON_FETCH_PATCH",
        type: "JSON_CAPTURED",
        ...payload,
      },
      "*"
    );
  };

  const headersToObject = (headers) => {
    const result = {};
    try {
      headers.forEach((value, key) => {
        result[key] = value;
      });
    } catch (_) {}
    return result;
  };

  const normalizeRequestHeaders = (input, init) => {
    const result = {};
    try {
      if (input instanceof Request) {
        Object.assign(result, headersToObject(input.headers));
      }
    } catch (_) {}

    try {
      const headers = init?.headers;
      if (!headers) return result;
      if (headers instanceof Headers) {
        Object.assign(result, headersToObject(headers));
      } else if (Array.isArray(headers)) {
        headers.forEach(([key, value]) => {
          if (key) result[String(key).toLowerCase()] = String(value);
        });
      } else if (typeof headers === "object") {
        Object.entries(headers).forEach(([key, value]) => {
          result[String(key).toLowerCase()] = String(value);
        });
      }
    } catch (_) {}

    return result;
  };

  const parseRawHeaders = (raw) => {
    const result = {};
    if (!raw) return result;
    raw
      .trim()
      .split(/\r?\n/)
      .forEach((line) => {
        const index = line.indexOf(":");
        if (index === -1) return;
        const key = line.slice(0, index).trim().toLowerCase();
        const value = line.slice(index + 1).trim();
        if (key) result[key] = value;
      });
    return result;
  };

  const looksLikeJson = (contentType) => {
    if (!contentType) return false;
    return (
      contentType.includes("application/json") ||
      contentType.includes("text/json") ||
      contentType.includes("+json")
    );
  };

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const start = performance.now();
    let requestUrl = "";
    let requestMethod = "GET";
    let requestHeaders = {};

    try {
      const input = args[0];
      const init = args[1] || {};
      requestUrl = input instanceof Request ? input.url : String(input);
      const methodCandidate =
        init.method || (input instanceof Request ? input.method : "GET");
      requestMethod = String(methodCandidate || "GET").toUpperCase();
      requestHeaders = normalizeRequestHeaders(input, init);
    } catch (_) {}

    const response = await originalFetch.apply(this, args);
    const duration = Math.round(performance.now() - start);

    try {
      const ct = response.headers.get("content-type") || "";
      if (looksLikeJson(ct)) {
        const clone = response.clone();
        clone
          .json()
          .then((data) =>
            notify({
              url: response.url || requestUrl,
              data,
              method: requestMethod,
              status: response.status,
              duration,
              responseHeaders: headersToObject(response.headers),
              requestHeaders,
            })
          )
          .catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  const OrigXHR = window.XMLHttpRequest;

  function SnapXHR() {
    const xhr = new OrigXHR();
    let capturedUrl = "";
    let capturedMethod = "GET";
    let start = 0;
    const requestHeaders = {};

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      capturedUrl = String(url);
      capturedMethod = String(method || "GET").toUpperCase();
      return origOpen(method, url, ...rest);
    };

    const origSetHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function (key, value) {
      try {
        requestHeaders[String(key).toLowerCase()] = String(value);
      } catch (_) {}
      return origSetHeader(key, value);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function (...args) {
      start = performance.now();
      return origSend(...args);
    };

    xhr.addEventListener("readystatechange", function () {
      if (xhr.readyState !== 4) return;
      try {
        const ct = xhr.getResponseHeader("content-type") || "";
        if (looksLikeJson(ct)) {
          const duration = Math.round(performance.now() - start);
          const responseHeaders = parseRawHeaders(xhr.getAllResponseHeaders());
          const data = JSON.parse(xhr.responseText);
          notify({
            url: capturedUrl || xhr.responseURL,
            data,
            method: capturedMethod,
            status: xhr.status,
            duration,
            responseHeaders,
            requestHeaders,
          });
        }
      } catch (_) {}
    });

    return xhr;
  }

  SnapXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = SnapXHR;
})();
