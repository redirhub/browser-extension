// Signing in from any page, and the prompt shown when a paid action needs an account.

import { h } from "./dom.js";
import { icon } from "./icons.js";
import { URL_REGISTER } from "./redirhub.js";

/** Sign-in runs on the options page, which stays open while the user is on RedirHub. */
export function openSignIn() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("src/options.html#connect") });
}

/** The prompt for an action that needs a RedirHub account. `afterOpen` runs once sign-in opens. */
export function showGate(title, { afterOpen } = {}) {
  document.getElementById("gate")?.remove();
  const close = () => gate.remove();
  const gate = h("div", { class: "gate", id: "gate" },
    h("div", { class: "gate-card", role: "dialog", "aria-labelledby": "gate-title" },
      h("div", { class: "gate-icon" }, icon("lock", 22)),
      h("h2", { id: "gate-title" }, title),
      h("p", {}, "The checks stay free. Connect your RedirHub account to save fixes as live redirects, import 404s in bulk, forward domains and export results."),
      h("ul", {},
        h("li", {}, "One-click 301s served from 130 Global PoPs"),
        h("li", {}, "Forward or redirect many domains at once"),
        h("li", {}, "Change rules later without touching server configs"),
      ),
      h("div", { class: "row" },
        h("button", { class: "btn primary", id: "gate-connect", type: "button", onclick: () => openSignIn().then(() => afterOpen?.()) }, "Connect RedirHub"),
        h("button", { class: "btn", type: "button", onclick: () => chrome.tabs.create({ url: URL_REGISTER }) }, "Create an account"),
      ),
      h("button", { class: "link", type: "button", onclick: close }, "Not now"),
    ),
  );
  document.body.append(gate);
}
