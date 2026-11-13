// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.

// The bridge page of a fragment OAuth provider (Trello). The provider puts the token in the URL
// fragment, which a browser never sends to a server. The page reads the token, removes the fragment
// from the address and the history, and only then posts the token to the callback: the relative URL
// `callback` next to `bridge`, with the same signed state. The pages are static and hold no request
// data. The route declares `bridgeScripts`; the CSP allows those scripts only (define-route.ts).

/** Removes the fragment, and with it the token, from the address and the history. */
const clear = `history.replaceState(null, "", location.pathname + location.search);`;

const post = `const status = document.getElementById("status");
const token = new URLSearchParams(location.hash.slice(1)).get("token");
${clear}
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
    (response) => {
      const result = response.headers.get("x-quills-result-location");
      if (result) location.replace(result);
      else show(response.ok ? "Connected. Close this page and go back to the integration settings." : failed);
    },
    () => show(failed),
  );`;

export const bridgeScripts = [post, clear];

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect an account</title></head><body><main>${body}</main></body></html>`;

export const bridgePage = page(
  `<h1>Connecting your account</h1><p id="status" role="status">Finishing the connection.</p><noscript>Turn on JavaScript to finish the connection.</noscript><script>${post}</script>`,
);

/** The answer to a second visit with the same state. A provider can send a new token to it. */
export const usedPage = page(
  `<h1>This connection page was already opened</h1><p>Check the integration settings. If the account is not connected, start the connection again.</p><script>${clear}</script>`,
);
