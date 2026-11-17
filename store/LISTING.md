# Chrome Web Store listing

Everything the Developer Dashboard asks for, ready to paste. Upload
`dist/redirhub-extension-<version>.zip` (`npm run pack`).

## Store listing tab

**Name** (from the manifest): RedirHub Redirect Path & 404 Catcher

**Summary** (from the manifest, 132 characters max): See every redirect a page goes
through (301, 302, HSTS, meta refresh, JavaScript), catch the 404s you hit, and fix
them in RedirHub.

**Category:** Developer Tools  **Language:** English

**Description:**

```
See exactly how a page reached you, and fix what is broken.

REDIRECT PATH
Click the RedirHub icon on any page to see every hop the browser followed:
• 301, 302, 303, 307 and 308 redirects, with the server that sent each one and how long it took
• Chrome's own HTTPS upgrade (HSTS), shown apart from real redirects
• Meta refresh and JavaScript redirects, which most header checkers miss
The toolbar badge counts the redirects and turns amber or red when something needs attention.

WHAT IT FLAGS
• Chains of several redirects: each hop adds a round trip and can lose ranking signals
• Temporary redirects (302, 307) where a permanent move belongs
• Client-side redirects that crawlers may not follow
• Redirect loops, drops from HTTPS to HTTP, and chains that end on an error

404 CATCHER
• Every page that answers 404 or 410 while you browse is listed per site, with the page that linked to it
• "Check the links on this page" tests every link of the page you are on to the same site: broken links, and links that go through a redirect with where they end up
• Each 404 comes with a suggested destination: the most similar live page of the site, its parent, or the home page

FIX IT IN REDIRHUB
Checks are free and need no account. Connect a RedirHub account to:
• Replace a whole chain with one 301 in a click
• Create 301s for the 404s you caught, in bulk
• Export them as a CSV for RedirHub's bulk import

PRIVACY
Traces and caught 404s stay in your browser. Nothing is sent anywhere until you save or export a rule; saved rules go to the RedirHub API only. You can turn off 404 catching and clear the data at any time.
```

**Images** (in `store/`): `screenshot-1.png` … `screenshot-5.png` (1280×800),
`promo-small-440x280.png`. The 128×128 icon comes from the ZIP.

**Official URL / homepage:** https://www.redirhub.com
**Support URL:** https://www.redirhub.com/support

## Privacy practices tab

**Single purpose:**

```
Shows the redirects and 404 errors of the pages the user visits, and lets the user turn them into redirect rules in their RedirHub account.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `webRequest` | Reads the status code and redirect target of each top-level page request to show the redirect chain and to detect pages that answer 404. Observes only; never blocks or changes a request. |
| `webNavigation` | Tells whether a navigation was started by a meta refresh or a script, so client-side redirects are shown as part of the chain. |
| `storage` | Keeps the chain of each open tab, the 404s caught per site, the settings and the user's RedirHub API token, in the browser. |
| Host permissions (`<all_urls>`) | Redirects cross sites (HTTP to HTTPS, one domain to another), so the extension must observe whatever site the user opens. The link check requests the links of the current page, and saving rules calls api.redirhub.com. |
| Content script on all sites | Detects a meta refresh tag on the page, and lists the page's links when the user asks for a link check. |

**Remote code:** No, I am not using remote code. (All code ships in the package.)

**Data usage, what is collected:**

- [x] Authentication information: the RedirHub API token the user pastes, sent only to api.redirhub.com.
- [x] Web history: URLs of pages the user visited, sent to RedirHub only when the user saves or exports a redirect rule for them.
- [x] Personally identifiable information: the name and email of the connected RedirHub account, read from the RedirHub API and shown in the extension.
- [ ] Everything else (health, financial, communications, location, user activity, website content): not collected.

**Certifications:** tick all three (no sale or transfer to third parties outside the
approved use; no use unrelated to the single purpose; no use for creditworthiness or lending).

**Privacy policy URL:** https://www.redirhub.com/legal/privacy-policy, once it has
the browser extension section below.

## Privacy policy: browser extension section (draft for approval)

To be added to the privacy policy (Sanity, legal page) before submitting:

```
RedirHub browser extension

The RedirHub Redirect Path & 404 Catcher extension shows the redirects and 404 errors of the pages you open in Chrome.

What stays in your browser. To work, the extension reads the addresses, status codes and redirect headers of the pages you open, and the links of a page when you ask it to check them. This information, the 404 errors it catches and your settings are stored in your browser only. Redirect traces are deleted when you close the tab; caught 404 errors stay until you clear them in the extension's settings or remove the extension. We do not receive this information.

What is sent to RedirHub. If you connect your RedirHub account, the extension stores your API token in your browser and sends it to the RedirHub API to identify you. When you choose to save or export redirect rules, the addresses in those rules are sent to your RedirHub account and handled under this policy like any other redirect you create.

The extension does not sell your data, does not use it for advertising, and does not send it to anyone other than RedirHub.
```
