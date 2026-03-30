document.addEventListener("DOMContentLoaded", () => {
  const status              = document.getElementById("status");
  const statusPill          = document.getElementById("status-pill");
  const jsonDisplay         = document.getElementById("json-display");
  const clearHistoryButton  = document.getElementById("clear-history-btn");
  const historyList         = document.getElementById("history-list");
  const filterDomain        = document.getElementById("filter-domain");
  const filterMethod        = document.getElementById("filter-method");
  const copyJsonButton      = document.getElementById("copy-json-btn");
  const exportButton        = document.getElementById("export-btn");
  const toggleHistoryButton = document.getElementById("toggle-history-btn");
  const togglePauseButton   = document.getElementById("toggle-pause-btn");
  const layout              = document.getElementById("layout");
  const excludeInput        = document.getElementById("exclude-input");
  const excludeAddButton    = document.getElementById("exclude-add-btn");
  const excludeList         = document.getElementById("exclude-list");
  const excludeModal        = document.getElementById("exclude-modal");
  const openExcludeButton   = document.getElementById("open-exclude-btn");
  const closeExcludeButton  = document.getElementById("close-exclude-btn");
  const metaMethod          = document.getElementById("meta-method");
  const metaStatus          = document.getElementById("meta-status");
  const metaDuration        = document.getElementById("meta-duration");
  const metaUrl             = document.getElementById("meta-url");

  const FILTER_ALL = "all";
  const METHOD_OPTIONS = [
    "ALL",
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD",
  ];

  let selectedItem = null;
  let paused = false;
  let excludedDomains = [];
  const collapsedGroups = new Set();

  /**
   * Actualiza el estado visible del panel.
   * @param {string} text
   * @param {boolean} isError
   */
  const setStatus = (text, isError = false) => {
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? "#ff7b7b" : "#4cc2ff";
  };

  /**
   * Escapa HTML para pintar contenido seguro.
   * @param {string} value
   * @returns {string}
   */
  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  /**
   * Aplica resaltado basico de sintaxis a JSON.
   * @param {string} json
   * @returns {string}
   */
  const syntaxHighlight = (json) =>
    escapeHtml(json).replace(
      /(".*?"\s*:)|(".*?")|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g,
      (match, key, str, prim) => {
        if (key) return `<span class="sj__json-key">${match}</span>`;
        if (str) return `<span class="sj__json-string">${match}</span>`;
        if (prim === "true" || prim === "false") {
          return `<span class="sj__json-boolean">${match}</span>`;
        }
        if (prim === "null") return `<span class="sj__json-null">${match}</span>`;
        return `<span class="sj__json-number">${match}</span>`;
      }
    );

  /**
   * Renderiza el JSON en el visor principal.
   * @param {string} value
   */
  const renderJson = (value) => {
    if (!jsonDisplay) return;
    jsonDisplay.innerHTML = syntaxHighlight(value || "{}");
  };

  /**
   * Normaliza una URL de pagina para agrupar historiales.
   * @param {string} url
   * @returns {string}
   */
  const normalizePageUrl = (url) => {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      
      parsed.hash   = "";
      parsed.search = "";
     
      return parsed.toString();
    } catch {
      return "";
    }
  };

  /**
   * Obtiene el origin de una URL.
   * @param {string} url
   * @returns {string}
   */
  const getOrigin = (url) => {
    if (!url) return "";
    try {
      return new URL(url).origin + "/";
    } catch {
      return "";
    }
  };

  /**
   * Devuelve la clase CSS para el metodo.
   * @param {string} method
   * @returns {string}
   */
  const getMethodClass = (method) => {
    const value     = method.toLowerCase();
    const supported = ["get", "post", "put", "patch", "delete"];
    return supported.includes(value) ? `sj__tag--method-${value}` : "sj__tag--method-default";
  };

  /**
   * Normaliza el dominio ingresado.
   * @param {string} value
   * @returns {string}
   */
  const normalizeDomain = (value) => {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed) return "";
    try {
      const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
      return url.hostname;
    } catch {
      return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
    }
  };

  /**
   * Carga el historial desde storage.
   * @returns {Promise<Array>}
   */
  const loadHistory = async () => {
    const data       = await chrome.storage.local.get("history");
    const history    = Array.isArray(data.history) ? data.history : [];
    const normalized = [];
    let   changed    = false;

    history.forEach((item) => {
      if (!item || typeof item !== "object") return;

      if (!item.pageOrigin && item.pageUrl) {
        try {
          item.pageOrigin = new URL(item.pageUrl).origin + "/";
          changed = true;
        } catch {
          item.pageOrigin = "";
        }
      }

      if (!item.pageOrigin && item.url && item.url.startsWith("/")) {
        changed = true;
        return;
      }

      normalized.push(item);
    });

    if (changed) {
      await chrome.storage.local.set({ history: normalized });
    }

    return normalized;
  };

  /**
   * Guarda el historial completo.
   * @param {Array} history
   * @returns {Promise<void>}
   */
  const saveHistory = async (history) => {
    await chrome.storage.local.set({ history });
  };

  /**
   * Agrupa historial por dominio.
   * @param {Array} history
   * @returns {Array}
   */
  const groupHistory = (history) => {
    const groups = new Map();
    history.forEach((item) => {
      const origin = item.pageOrigin || getOrigin(normalizePageUrl(item.pageUrl));
      if (!origin) return;
      if (!groups.has(origin)) {
        groups.set(origin, { key: origin, label: origin, items: [] });
      }
      groups.get(origin).items.push(item);
    });
    return Array.from(groups.values());
  };

  /**
   * Actualiza los filtros por dominio y metodo.
   * @param {Array} history
   */
  const syncFilters = (history) => {
    if (!filterDomain || !filterMethod) return;

    const domains = Array.from(
      new Set(
        history
          .map((item) => item.pageOrigin || getOrigin(item.pageUrl || ""))
          .filter(Boolean)
      )
    ).sort();

    const currentDomain = filterDomain.value || FILTER_ALL;
    filterDomain.innerHTML = "";

    const allDomainOption = document.createElement("option");

    allDomainOption.value       = FILTER_ALL;
    allDomainOption.textContent = domains.length ? "Todos los dominios" : "Sin datos";
    filterDomain.appendChild(allDomainOption);

    domains.forEach((domain) => {
      const option = document.createElement("option");
      option.value = domain;
      option.textContent = domain;
      filterDomain.appendChild(option);
    });

    filterDomain.value    = domains.includes(currentDomain) ? currentDomain : FILTER_ALL;
    filterDomain.disabled = domains.length === 0;

    if (history.length === 0) {
      filterMethod.innerHTML = "";
      const emptyOption = document.createElement("option");
      
      emptyOption.value       = FILTER_ALL;
      emptyOption.textContent = "Sin datos";

      filterMethod.appendChild(emptyOption);
      filterMethod.disabled = true;
    } else {
      filterMethod.innerHTML = "";
      METHOD_OPTIONS.forEach((method) => {
        const option = document.createElement("option");

        option.value       = method === "ALL" ? FILTER_ALL : method;
        option.textContent = method === "ALL" ? "Todos los metodos" : method;

        filterMethod.appendChild(option);
      });
      filterMethod.disabled = false;
    }
  };

  /**
   * Aplica filtros a una lista de historial.
   * @param {Array} history
   * @returns {Array}
   */
  const applyFilters = (history) => {
    let   result      = [...history];
    const domainValue = filterDomain?.value || FILTER_ALL;
    const methodValue = filterMethod?.value || FILTER_ALL;

    if (domainValue !== FILTER_ALL) {
      result = result.filter((item) => (item.pageOrigin || "") === domainValue);
    }

    if (methodValue !== FILTER_ALL) {
      result = result.filter(
        (item) => (item.method || "GET").toUpperCase() === methodValue
      );
    }

    return result;
  };

  /**
   * Elimina una captura por id.
   * @param {number} id
   */
  const removeItem = async (id) => {
    const history = await loadHistory();
    const next    = history.filter((item) => item.id !== id);
    await saveHistory(next);
    if (selectedItem && selectedItem.id === id) {
      setSelected(next[0] || null);
    }
  };

  /**
   * Elimina un grupo completo por dominio.
   * @param {string} groupKey
   */
  const removeGroup = async (groupKey) => {
    const history = await loadHistory();
    const next    = history.filter((item) => item.pageOrigin !== groupKey);
    await saveHistory(next);
    if (selectedItem) {
      const stillExists = next.some((item) => item.id === selectedItem.id);
      if (!stillExists) setSelected(next[0] || null);
    }
  };

  /**
   * Renderiza la columna de historial.
   * @param {Array} history
   */
  const renderHistory = (history) => {
    if (!historyList) return;
    historyList.innerHTML = "";

    if (!history.length) {
      const empty = document.createElement("div");
      empty.className = "sj__empty";
      empty.textContent = "Sin capturas aun.";
      historyList.appendChild(empty);
      return;
    }

    syncFilters(history);
    const filtered = applyFilters(history);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "sj__empty";
      empty.textContent = "No hay resultados con esos filtros.";
      historyList.appendChild(empty);
      return;
    }

    const grouped = groupHistory(filtered);
    grouped.forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.className = "sj__group";

      const header = document.createElement("div");
      header.className = "sj__group-header";
      header.addEventListener("click", () => {
        if (collapsedGroups.has(group.key)) {
          collapsedGroups.delete(group.key);
        } else {
          collapsedGroups.add(group.key);
        }
        renderHistory(history);
      });

      const titleWrap = document.createElement("span");
      titleWrap.className = "sj__group-title";

      const chevron = document.createElement("span");
      chevron.className = "sj__group-chevron";
      chevron.innerHTML =
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>";

      const title = document.createElement("span");
      title.className = "sj__group-text";
      title.textContent = group.label;

      titleWrap.appendChild(chevron);
      titleWrap.appendChild(title);

      const count = document.createElement("span");
      count.className = "sj__group-count";
      count.textContent = `${group.items.length} capturas`;

      const actions = document.createElement("span");
      actions.className = "sj__group-actions";
      const removeGroupBtn = document.createElement("button");
      removeGroupBtn.type = "button";
      removeGroupBtn.innerHTML =
        "<svg viewBox='0 0 24 24' width='12' height='12' fill='none' stroke='currentColor' stroke-width='2'><path d='M3 6h18'/><path d='M8 6V4h8v2'/><path d='M19 6l-1 14H6L5 6'/></svg>";
      removeGroupBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeGroup(group.key);
      });
      actions.appendChild(removeGroupBtn);

      header.appendChild(titleWrap);
      header.appendChild(count);
      header.appendChild(actions);
      groupEl.appendChild(header);

      if (collapsedGroups.has(group.key)) {
        groupEl.classList.add("sj__group--collapsed");
      }

      const items = document.createElement("div");
      items.className = "sj__items";

      group.items.forEach((item) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "sj__item";

        const meta = document.createElement("div");
        meta.className = "sj__item-meta";

        const time = document.createElement("span");
        time.textContent = new Date(item.createdAt).toLocaleTimeString();

        const duration = document.createElement("span");
        duration.className = "sj__item-duration";
        duration.textContent = item.duration ? `${item.duration} ms` : "-- ms";

        const tags = document.createElement("span");
        tags.className = "sj__item-tags";

        const method = document.createElement("span");
        const methodValue = (item.method || "GET").toUpperCase();
        method.className = `sj__tag ${getMethodClass(methodValue)}`;
        method.textContent = methodValue;

        const statusTag = document.createElement("span");
        const statusValue = item.status || 0;
        statusTag.className =
          statusValue >= 200 && statusValue < 400
            ? "sj__tag sj__tag--status-success"
            : statusValue >= 400
              ? "sj__tag sj__tag--status-error"
              : "sj__tag sj__tag--status-neutral";
        statusTag.textContent = statusValue ? String(statusValue) : "--";

        tags.appendChild(method);
        tags.appendChild(statusTag);

        const urlText = (item.url || "").replace(/^https?:\/\//, "");
        const url = document.createElement("span");
        url.className = "sj__item-url";
        url.title = item.url || "";
        url.textContent = urlText || "captura";

        meta.appendChild(time);
        meta.appendChild(duration);
        meta.appendChild(tags);
        meta.appendChild(url);

        const preview = document.createElement("code");
        preview.className = "sj__item-preview";
        preview.textContent = item.json.replace(/\s+/g, " ").slice(0, 140);

        const itemActions = document.createElement("div");
        itemActions.className = "sj__item-actions";
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.innerHTML =
          "<svg viewBox='0 0 24 24' width='12' height='12' fill='none' stroke='currentColor' stroke-width='2'><path d='M3 6h18'/><path d='M8 6V4h8v2'/><path d='M19 6l-1 14H6L5 6'/></svg>";
        removeBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          removeItem(item.id);
        });
        itemActions.appendChild(removeBtn);

        card.appendChild(meta);
        card.appendChild(preview);
        card.appendChild(itemActions);
        card.addEventListener("click", () => setSelected(item));

        items.appendChild(card);
      });

      groupEl.appendChild(items);
      historyList.appendChild(groupEl);
    });
  };

  /**
   * Renderiza la lista de dominios excluidos.
   */
  const renderExcluded = () => {
    if (!excludeList) return;
    excludeList.innerHTML = "";

    if (!excludedDomains.length) {
      const empty = document.createElement("div");
      empty.className = "sj__empty";
      empty.textContent = "Sin dominios excluidos";
      excludeList.appendChild(empty);
      return;
    }

    excludedDomains.forEach((domain) => {
      const item = document.createElement("div");
      item.className = "sj-modal__item";

      const text = document.createElement("span");
      text.textContent = `https://${domain}/`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Quitar";
      remove.addEventListener("click", () => removeExcluded(domain));

      item.appendChild(text);
      item.appendChild(remove);
      excludeList.appendChild(item);
    });
  };

  /**
   * Agrega un dominio a la lista de exclusiones.
   * @param {string} domain
   */
  const addExcluded = async (domain) => {
    const normalized = normalizeDomain(domain);
    if (!normalized) return;
    if (!excludedDomains.includes(normalized)) {
      excludedDomains = [normalized, ...excludedDomains];
      await chrome.storage.local.set({ excludedDomains });
      renderExcluded();
    }
  };

  /**
   * Elimina un dominio de la lista de exclusiones.
   * @param {string} domain
   */
  const removeExcluded = async (domain) => {
    excludedDomains = excludedDomains.filter((item) => item !== domain);
    await chrome.storage.local.set({ excludedDomains });
    renderExcluded();
  };

  /**
   * Actualiza el panel derecho con la captura seleccionada.
   * @param {object|null} item
   */
  function setSelected(item) {
    selectedItem = item;
    if (!item) {
      renderJson("{}");
      if (metaMethod) metaMethod.textContent = "--";
      if (metaStatus) metaStatus.textContent = "--";
      if (metaDuration) metaDuration.textContent = "-- ms";
      if (metaUrl) metaUrl.textContent = "Selecciona una captura";
      return;
    }

    renderJson(item.json);
    if (metaMethod) metaMethod.textContent = (item.method || "GET").toUpperCase();
    if (metaStatus) metaStatus.textContent = item.status ? String(item.status) : "--";
    if (metaDuration)
      metaDuration.textContent = item.duration
        ? `${item.duration} ms`
        : "-- ms";
    if (metaUrl) metaUrl.textContent = item.url || "captura";
  }

  clearHistoryButton?.addEventListener("click", async () => {
    await saveHistory([]);
    renderHistory([]);
    setSelected(null);
    setStatus("Historial borrado");
  });

  toggleHistoryButton?.addEventListener("click", () => {
    if (!layout) return;
    layout.classList.toggle("sj__layout--collapsed");
    if (toggleHistoryButton) {
      toggleHistoryButton.textContent = layout.classList.contains("sj__layout--collapsed")
        ? "Mostrar"
        : "Ocultar";
    }
    chrome.storage.local.set({
      sidebarCollapsed: layout.classList.contains("sj__layout--collapsed"),
    });
  });

  togglePauseButton?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TOGGLE_PAUSE" }, (response) => {
      if (!response || chrome.runtime.lastError) {
        setStatus("No se pudo cambiar el estado", true);
        return;
      }
      paused = response.paused === true;
      if (togglePauseButton) {
        togglePauseButton.textContent = paused ? "Reanudar" : "Pausar";
        togglePauseButton.classList.toggle("sj__btn--paused", paused);
        togglePauseButton.classList.toggle("sj__btn--active", !paused);
      }
      if (statusPill) {
        statusPill.classList.toggle("sj__status--paused", paused);
        statusPill.classList.toggle("sj__status--active", !paused);
      }
      setStatus(paused ? "Captura pausada" : "Captura activa");
    });
  });

  filterDomain?.addEventListener("change", () => {
    loadHistory().then(renderHistory);
  });

  filterMethod?.addEventListener("change", () => {
    loadHistory().then(renderHistory);
  });

  copyJsonButton?.addEventListener("click", async () => {
    if (!selectedItem) return setStatus("Selecciona una captura", true);
    try {
      await navigator.clipboard.writeText(selectedItem.json);
      setStatus("JSON copiado");
    } catch {
      setStatus("No se pudo copiar", true);
    }
  });

  exportButton?.addEventListener("click", () => {
    if (!selectedItem) return setStatus("Selecciona una captura", true);
    const payload = {
      url: selectedItem.url,
      method: selectedItem.method,
      status: selectedItem.status,
      durationMs: selectedItem.duration,
      body: (() => {
        try {
          return JSON.parse(selectedItem.json);
        } catch {
          return selectedItem.json;
        }
      })(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "snapjson-captura.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  openExcludeButton?.addEventListener("click", () => {
    if (!excludeModal) return;
    excludeModal.classList.add("sj-modal--open");
    excludeModal.setAttribute("aria-hidden", "false");
  });

  closeExcludeButton?.addEventListener("click", () => {
    if (!excludeModal) return;
    excludeModal.classList.remove("sj-modal--open");
    excludeModal.setAttribute("aria-hidden", "true");
  });

  excludeModal?.addEventListener("click", (event) => {
    if (event.target !== excludeModal) return;
    excludeModal.classList.remove("sj-modal--open");
    excludeModal.setAttribute("aria-hidden", "true");
  });

  excludeAddButton?.addEventListener("click", () => {
    if (!excludeInput) return;
    addExcluded(excludeInput.value);
    excludeInput.value = "";
  });

  excludeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addExcluded(excludeInput.value);
    excludeInput.value = "";
  });

  setStatus("Interceptando peticiones...");
  loadHistory().then((history) => {
    renderHistory(history);
    if (history[0]) setSelected(history[0]);
  });

  chrome.storage.local.get(["excludedDomains"]).then((data) => {
    excludedDomains = Array.isArray(data.excludedDomains)
      ? data.excludedDomains
      : [];
    renderExcluded();
  });

  chrome.storage.local.get(["sidebarCollapsed"]).then((data) => {
    if (!layout) return;
    const collapsed = data.sidebarCollapsed === true;
    layout.classList.toggle("sj__layout--collapsed", collapsed);
    if (toggleHistoryButton) {
      toggleHistoryButton.textContent = collapsed ? "Mostrar" : "Ocultar";
    }
  });

  chrome.runtime.sendMessage({ type: "GET_PAUSE_STATE" }, (response) => {
    if (!response || chrome.runtime.lastError) return;
    paused = response.paused === true;
    if (togglePauseButton) {
      togglePauseButton.textContent = paused ? "Reanudar" : "Pausar";
      togglePauseButton.classList.toggle("sj__btn--paused", paused);
      togglePauseButton.classList.toggle("sj__btn--active", !paused);
    }
    if (statusPill) {
      statusPill.classList.toggle("sj__status--paused", paused);
      statusPill.classList.toggle("sj__status--active", !paused);
    }
  });

  chrome.runtime.sendMessage({ type: "PANEL_READY" }, () => {
    void chrome.runtime.lastError;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.history) {
      const history = changes.history.newValue || [];
      renderHistory(history);

      const prev = changes.history.oldValue || [];
      if (history.length > prev.length && history[0]) {
        const latest = history[0];
        setSelected(latest);
        setStatus("Nueva captura");
      }
    }

    if (changes.excludedDomains) {
      excludedDomains = Array.isArray(changes.excludedDomains.newValue)
        ? changes.excludedDomains.newValue
        : [];
      renderExcluded();
    }
  });
});
