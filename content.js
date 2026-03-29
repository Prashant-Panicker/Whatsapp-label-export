// ISOLATED world bridge — relays popup ↔ MAIN world via DOM custom events
function bridgeToMain(detail) {
  return new Promise((resolve) => {
    const handler = (e) => {
      document.removeEventListener("WLE_RESPONSE", handler);
      resolve(e.detail);
    };
    document.addEventListener("WLE_RESPONSE", handler);
    document.dispatchEvent(new CustomEvent("WLE_REQUEST", { detail }));
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const validTypes = [
    "collect-label-contacts",
    "get-all-labels",
    "inspect-store"
  ];

  if (validTypes.includes(message?.type)) {
    bridgeToMain(message)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
