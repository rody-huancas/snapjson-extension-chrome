chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return;
  }

  console.warn(
    "chrome.sidePanel no esta disponible. Actualiza Chrome o habilita la API."
  );
});
