import { URL_API_TOKENS, URL_REGISTER } from "./lib/redirhub.js";

const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

$("tokens").href = URL_API_TOKENS;
$("register").href = URL_REGISTER;

function show(account) {
  $("connect").hidden = Boolean(account);
  $("connected").hidden = !account;
  if (!account) return;
  $("name").textContent = account.name || account.email;
  $("email").textContent = [account.email, account.workspace].filter(Boolean).join(" · ");
  $("initials").textContent = (account.name || account.email).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").hidden = true;
  const answer = await send({ type: "sign-in", token: $("token").value.trim() });
  if (!answer.ok) {
    $("error").textContent = answer.error;
    $("error").hidden = false;
    return;
  }
  $("token").value = "";
  show(answer.account);
});

$("signout").addEventListener("click", async () => {
  await send({ type: "sign-out" });
  show(null);
});

$("capture").addEventListener("change", (event) => send({ type: "set-settings", settings: { capture404: event.target.checked } }));
$("clear").addEventListener("click", async () => {
  await send({ type: "clear-data" });
  $("clear").textContent = "Cleared";
});

(async () => {
  const [auth, notFound] = await Promise.all([send({ type: "get-auth" }), send({ type: "get-not-found", host: "" })]);
  show(auth.account);
  $("capture").checked = notFound.settings?.capture404 ?? true;
})();
