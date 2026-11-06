// Anonymous page-view ping. Runs after the page has fully loaded, never blocks or changes anything,
// and ignores every error. Sends only the page path and where the visitor came from.
(function () {
  function send() {
    try {
      var data = JSON.stringify({ p: location.pathname, r: document.referrer || "" });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/track", new Blob([data], { type: "application/json" }))) return;
      fetch("/api/track", { method: "POST", body: data, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function () {});
    } catch (e) {}
  }
  function later() { setTimeout(send, 1500); }
  if (document.readyState === "complete") later(); else window.addEventListener("load", later);
})();
