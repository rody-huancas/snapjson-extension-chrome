document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const jsonInput = document.getElementById("json-input");
  const jsonDisplay = document.getElementById("json-display");
  const pasteButton = document.getElementById("paste-btn");
  const formatButton = document.getElementById("format-btn");
  const clearButton = document.getElementById("clear-btn");

  if (status) {
    status.textContent = "Listo para capturar";
  }

  const setStatus = (text, isError) => {
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? "#ff7b7b" : "#4cc2ff";
  };

  const renderJson = (value) => {
    if (!jsonDisplay) return;
    jsonDisplay.textContent = value || "{}";
  };

  const formatJson = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      setStatus("JSON invalido", true);
      return null;
    }
  };

  if (pasteButton) {
    pasteButton.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (jsonInput) {
          jsonInput.value = text;
        }
        const formatted = formatJson(text);
        if (formatted) {
          renderJson(formatted);
          setStatus("JSON pegado", false);
        }
      } catch (error) {
        setStatus("No se pudo leer el portapapeles", true);
      }
    });
  }

  if (formatButton) {
    formatButton.addEventListener("click", () => {
      if (!jsonInput) return;
      const formatted = formatJson(jsonInput.value.trim());
      if (formatted) {
        renderJson(formatted);
        setStatus("JSON formateado", false);
      }
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (jsonInput) {
        jsonInput.value = "";
      }
      renderJson("{}");
      setStatus("Listo para capturar", false);
    });
  }
});
