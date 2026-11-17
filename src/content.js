// Tells the extension when a page has a meta refresh, so a client redirect can
// be named, hands the popup this page's links for the broken-link check, and on
// the dashboard's connect page relays the API token the dashboard creates.
(() => {
  // The dashboard's /connect/extension page (redirhub/lviv, src/lib/extensionConnect.ts). The
  // background checks the page's origin and the one-time state; this only relays.
  if (location.pathname === "/connect/extension") {
    const post = (data) => window.postMessage({ source: "extension", ...data }, location.origin);
    window.addEventListener("message", async (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "dashboard") return;
      if (event.data.type === "ping") {
        const { waiting } = await chrome.runtime.sendMessage({ type: "connect-hello" });
        if (waiting) post({ type: "hello" });
      }
      if (event.data.type === "token") {
        const answer = await chrome.runtime.sendMessage({ type: "connect-token", state: event.data.state, token: event.data.token });
        if (answer?.ok) post({ type: "connected", name: answer.account.name || answer.account.email, workspace: answer.account.workspace || "" });
        else post({ type: "failed", error: answer?.error || "The extension did not answer." });
      }
    });
  }

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
      // Requesting these would sign the user out or start a download.
      if (anchor.hasAttribute("download") || /log-?out|sign-?out|log-?off/i.test(url.pathname + url.search)) continue;
      url.hash = "";
      if (url.href !== location.href) links.add(url.href);
    }
    reply({ links: [...links] });
    return false;
  });
})();
