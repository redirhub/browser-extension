import { connect } from "./connect.js";
import { URL_CONNECTIONS } from "./lib/config.js";
import { URL_REGISTER } from "./lib/redirhub.js";

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

$("connections").href = URL_CONNECTIONS;
$("register").href = URL_REGISTER;

function show(account) {
  $("connect").hidden = Boolean(account);
  $("connected").hidden = !account;
  if (!account) return;
  $("name").textContent = account.name || account.email;
  $("email").textContent = [account.email, account.workspace].filter(Boolean).join(" · ");
  $("initials").textContent = (account.name || account.email).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

async function startConnect() {
  const button = $("connect-button");
  button.disabled = true;
  $("error").hidden = true;
  try {
    show(await connect());
  } catch (error) {
    $("error").textContent = error.message;
    $("error").hidden = false;
  } finally {
    button.disabled = false;
  }
}

$("connect-button").addEventListener("click", startConnect);

$("signout").addEventListener("click", async () => {
  await send({ type: "sign-out" });
  show(null);
});

$("capture").addEventListener("change", (event) => send({ type: "set-settings", settings: { capture404: event.target.checked } }));
$("clear").addEventListener("click", async () => {
  await send({ type: "clear-data" });
  $("clear").textContent = "Cleared";
});

// The connection can also end while this page is open (a refused token).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.auth) show(changes.auth.newValue?.account || null);
});

(async () => {
  const [auth, notFound] = await Promise.all([send({ type: "get-auth" }), send({ type: "get-not-found", host: "" })]);
  show(auth.account);
  $("capture").checked = notFound.settings?.capture404 ?? true;
  // Opened from the popup's Connect: start right away.
  if (location.hash === "#connect" && !auth.account) {
    history.replaceState(null, "", location.pathname);
    startConnect();
  }
})();
