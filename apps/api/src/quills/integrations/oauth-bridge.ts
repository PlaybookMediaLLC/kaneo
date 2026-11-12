// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.

// The bridge page of a fragment OAuth provider (Trello). The provider puts the token in the URL
// fragment, which a browser never sends to a server. The page reads the token, removes the fragment
// from the address and the history, and only then posts the token to the callback: the relative URL
// `callback` next to `bridge`, with the same signed state. The page is static and holds no request
// data. The framework allows its one inline script by hash (define-route.ts, `htmlHeaders`).

const script = `const status = document.getElementById("status");
const token = new URLSearchParams(location.hash.slice(1)).get("token");
history.replaceState(null, "", location.pathname + location.search);
const show = (text) => {
  status.textContent = text;
};
const failed = "The connection failed. Go back to the integration settings and try again.";
if (!token) show("The account did not give access. Go back to the integration settings and try again.");
else
  fetch("callback" + location.search, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).then(
    (response) => show(response.ok ? "Connected. Close this page and go back to the integration settings." : failed),
    () => show(failed),
  );`;

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect an account</title></head><body><main>${body}</main></body></html>`;

export const bridgePage = page(
  `<h1>Connecting your account</h1><p id="status" role="status">Finishing the connection.</p><noscript>Turn on JavaScript to finish the connection.</noscript><script>${script}</script>`,
);

/** The answer to a second visit with the same state. */
export const usedPage = page(
  "<h1>This connection page was already opened</h1><p>Go back to the integration settings and start the connection again.</p>",
);
