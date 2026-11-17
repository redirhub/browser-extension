// Small DOM helpers shared by the extension's pages.

/** An element: h("a", { href, onclick }, "text", child, [more]). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const plural = (n, one, many = one + "s") => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** A short message at the bottom of the page; "success" colours it green. */
export function toast(text, tone = "") {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `toast ${tone}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4000);
}
