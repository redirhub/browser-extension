// Tells the extension when a page has a meta refresh, so a client redirect can
// be named, and hands the popup this page's links for the broken-link check.
(() => {
  function reportMetaRefresh() {
    const tag = document.querySelector('meta[http-equiv="refresh" i]');
    if (!tag) return;
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:[;,]\s*(?:url\s*=\s*)?['"]?([^'"]*)['"]?)?/i.exec(tag.content || "");
    if (!match || !match[2]) return;
    chrome.runtime.sendMessage({
      type: "meta-refresh",
      url: location.href,
      delay: Number(match[1]),
      target: new URL(match[2].trim(), location.href).href,
    }).catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reportMetaRefresh, { once: true });
  else reportMetaRefresh();

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== "collect-links") return false;
    const links = new Set();
    for (const anchor of document.querySelectorAll("a[href]")) {
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), location.href);
      } catch {
        continue;
      }
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) continue;
      url.hash = "";
      if (url.href !== location.href) links.add(url.href);
    }
    reply({ links: [...links] });
    return false;
  });
})();
